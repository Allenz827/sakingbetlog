// Import the functions you need from the Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Global variables from the Canvas environment
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase
let app, db, auth;
let isFirebaseInitialized = false;

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    isFirebaseInitialized = true;
} catch (error) {
    console.error("Firebase initialization failed:", error);
    showNotification("Failed to initialize Firebase. Check your configuration.", "error");
    setLoading(false);
}

document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL STATE & CONFIG ---
    let bets = []; // This will be populated by Firestore
    let profitChart = null;
    let currentTheme = localStorage.getItem('theme') || 'dark';
    let currentCurrency = JSON.parse(localStorage.getItem('currency')) || { symbol: '₱', code: 'PHP' };
    let currentSortCriteria = 'date_desc';
    let betsCollectionRef;
    let unsubscribeFromBets;
    let isDbReady = false;
    let userId = null;

    const currencies = {
        'USD': { symbol: '$', code: 'USD' },
        'PHP': { symbol: '₱', code: 'PHP' },
        'THB': { symbol: '฿', code: 'THB' },
        'MYR': { symbol: 'RM', code: 'MYR' },
        'HKD': { symbol: 'HK$', code: 'HKD' },
    };

    // --- DOM ELEMENT SELECTORS ---
    const themeSwitcher = document.getElementById('themeSwitcher');
    const currencySelector = document.getElementById('currencySelector');
    const notificationContainer = document.getElementById('notification-container');
    const notificationMessage = document.getElementById('notification-message');
    const notificationElement = document.getElementById('notification');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmBtn = document.getElementById('confirmBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    
    // --- HELPER FUNCTIONS ---
    const getManilaDateString = () => {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const manilaTime = new Date(utc + (3600000 * 8));
        return manilaTime.toISOString().split('T')[0];
    };

    const formatCurrency = (amount) => `${currentCurrency.symbol}${amount.toFixed(2)}`;

    const calculateProfitLoss = (bet) => {
        if (bet.result === 'Won') return (bet.stake * bet.odds) - bet.stake;
        if (bet.result === 'Lost') return -bet.stake;
        return 0;
    };
    
    const showNotification = (message, type = 'success') => {
        notificationMessage.textContent = message;
        notificationElement.className = 'notification glass-card';
        notificationElement.classList.add(type);
        notificationContainer.classList.add('show');
        setTimeout(() => notificationContainer.classList.remove('show'), 3000);
    };
    
    const setLoading = (isLoading) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = isLoading ? 'flex' : 'none';
        }
    };

    // --- THEME & CURRENCY ---
    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = theme === 'light' ? 'ph-fill ph-moon' : 'ph-fill ph-sun';
        if (themeSwitcher) themeSwitcher.innerHTML = `<i class="${icon}"></i>`;
    };

    const initUniversalControls = () => {
        applyTheme(currentTheme);
        if (themeSwitcher) {
            themeSwitcher.addEventListener('click', () => {
                currentTheme = currentTheme === 'light' ? 'dark' : 'light';
                localStorage.setItem('theme', currentTheme);
                applyTheme(currentTheme);
                updateAllUI();
            });
        }
        if (currencySelector) {
            currencySelector.value = currentCurrency.code;
            currencySelector.addEventListener('change', (e) => {
                currentCurrency = currencies[e.target.value];
                localStorage.setItem('currency', JSON.stringify(currentCurrency));
                updateAllUI();
            });
        }
    };

    // --- FIREBASE AUTHENTICATION & DATA HANDLING ---
    if (isFirebaseInitialized) {
        onAuthStateChanged(auth, async (user) => {
            try {
                if (user) {
                    console.log("User signed in with UID:", user.uid);
                    userId = user.uid;
                    // The collection path MUST include the app ID and user ID for proper security rules
                    const collectionPath = `/artifacts/${appId}/users/${userId}/bets`;
                    betsCollectionRef = collection(db, collectionPath);
                    isDbReady = true;
                    listenForBets();
                    const userIdDisplay = document.getElementById('userIdDisplay');
                    if (userIdDisplay) {
                        userIdDisplay.textContent = `User ID: ${userId}`;
                    }
                } else {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                }
            } catch (error) {
                console.error("Authentication failed:", error);
                showNotification("Could not connect to the database.", "error");
            } finally {
                setLoading(false); // ALWAYS hide the loading screen after auth attempt
            }
        });
    }

    const listenForBets = () => {
        if (unsubscribeFromBets) unsubscribeFromBets();
        
        // Removed orderBy from the query to prevent potential index errors.
        // Sorting will now be handled client-side.
        unsubscribeFromBets = onSnapshot(betsCollectionRef, (snapshot) => {
            // Fetch all bets
            bets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            
            // Call the unified UI update function
            updateAllUI();

        }, error => {
            console.error("Error fetching bets:", error);
            showNotification("Error fetching your bets.", "error");
        });
    };

    // --- UNIFIED UI UPDATE FUNCTION ---
    const updateAllUI = () => {
        if (document.getElementById('betList')) {
            const activeFilter = document.querySelector('.filter-btn.active');
            const period = activeFilter ? activeFilter.dataset.period : 'all';
            let customDates = {};
            if (period === 'custom') {
                customDates.start = document.getElementById('startDate').value;
                customDates.end = document.getElementById('endDate').value;
            }
            const filteredBets = filterBets(bets, period, customDates);
            const sortedBets = sortBets(filteredBets, currentSortCriteria);
            displayStats(filteredBets);
            displayBetList(sortedBets);
            renderProfitChart(filteredBets);
        }
    };

    // --- PAGE-SPECIFIC LOGIC ---

    // ADD BET PAGE
    if (document.getElementById('addBetForm')) {
        const addBetForm = document.getElementById('addBetForm');
        const betDateInput = document.getElementById('betDate');
        betDateInput.value = getManilaDateString();

        addBetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!isDbReady || !betsCollectionRef) {
                showNotification("Database not ready. Please wait a moment and try again.", "error");
                return;
            }
            const newBet = {
                date: document.getElementById('betDate').value,
                sport: document.getElementById('sport').value,
                details: document.getElementById('betDetails').value,
                stake: parseFloat(document.getElementById('stake').value),
                odds: parseFloat(document.getElementById('odds').value),
                result: document.getElementById('result').value,
                notes: document.getElementById('notes').value,
            };
            try {
                await addDoc(betsCollectionRef, newBet);
                localStorage.setItem('showBetLoggedNotification', 'true');
                window.location.href = 'index.html';
            } catch (error) {
                console.error("Error adding bet:", error);
                showNotification("Failed to log bet.", "error");
            }
        });
    }

    // DASHBOARD PAGE
    const displayStats = (filteredBets) => {
        if (!document.getElementById('netProfit')) return;

        const totalStake = filteredBets.reduce((sum, bet) => sum + bet.stake, 0);
        const totalProfit = filteredBets.reduce((sum, bet) => sum + calculateProfitLoss(bet), 0);
        const wonBets = filteredBets.filter(bet => bet.result === 'Won').length;
        const totalBets = filteredBets.filter(bet => bet.result !== 'Pending').length;
        const roi = totalStake > 0 ? (totalProfit / totalStake) * 100 : 0;
        const accuracy = totalBets > 0 ? (wonBets / totalBets) * 100 : 0;

        document.getElementById('netProfit').textContent = formatCurrency(totalProfit);
        document.getElementById('turnover').textContent = formatCurrency(totalStake);
        document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
        document.getElementById('accuracy').textContent = `${accuracy.toFixed(2)}%`;
        document.getElementById('totalBets').textContent = filteredBets.length;
        document.getElementById('wonBets').textContent = wonBets;
        document.getElementById('lostBets').textContent = filteredBets.filter(bet => bet.result === 'Lost').length;
        document.getElementById('pendingBets').textContent = filteredBets.filter(bet => bet.result === 'Pending').length;

        // Apply color based on net profit
        const netProfitElement = document.getElementById('netProfit');
        if (netProfitElement) {
            netProfitElement.classList.toggle('positive', totalProfit >= 0);
            netProfitElement.classList.toggle('negative', totalProfit < 0);
        }
    };

    const renderProfitChart = (filteredBets) => {
        const ctx = document.getElementById('profitChart');
        if (!ctx) return;

        if (profitChart) profitChart.destroy();

        const dailyProfits = filteredBets.reduce((acc, bet) => {
            const date = bet.date;
            const profit = calculateProfitLoss(bet);
            acc[date] = (acc[date] || 0) + profit;
            return acc;
        }, {});

        const sortedDates = Object.keys(dailyProfits).sort();
        const cumulativeProfits = sortedDates.reduce((acc, date) => {
            const lastTotal = acc.length > 0 ? acc[acc.length - 1] : 0;
            acc.push(lastTotal + dailyProfits[date]);
            return acc;
        }, []);

        const chartData = {
            labels: sortedDates,
            datasets: [{
                label: 'Cumulative Profit/Loss',
                data: cumulativeProfits,
                borderColor: currentTheme === 'dark' ? '#39ff14' : '#3d52a0',
                backgroundColor: 'rgba(57, 255, 20, 0.2)',
                tension: 0.4,
                fill: true,
            }]
        };

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: {
                        color: currentTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                    },
                    ticks: { color: currentTheme === 'dark' ? '#e0e0e0' : '#0d1117' }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: currentTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
                    },
                    ticks: { color: currentTheme === 'dark' ? '#e0e0e0' : '#0d1117' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: currentTheme === 'dark' ? '#e0e0e0' : '#0d1117' }
                }
            }
        };

        profitChart = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: chartOptions
        });
    };

    const filterBets = (betsArray, period, customDates) => {
        const now = new Date();
        let startDate, endDate = new Date(now.setHours(23, 59, 59, 999));
        
        switch (period) {
            case 'today':
                startDate = new Date(now.setHours(0, 0, 0, 0));
                break;
            case 'yesterday':
                const y = new Date();
                y.setDate(y.getDate() - 1);
                startDate = new Date(y.setHours(0, 0, 0, 0));
                endDate = new Date(y.setHours(23, 59, 59, 999));
                break;
            case '7d':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
                break;
            case 'custom':
                if (customDates.start && customDates.end) {
                    startDate = new Date(customDates.start);
                    endDate = new Date(customDates.end);
                } else {
                    return betsArray; // Return all bets if custom dates are not set
                }
                break;
            case 'all':
            default:
                return betsArray;
        }

        return betsArray.filter(bet => {
            const betDate = new Date(bet.date);
            return betDate >= startDate && betDate <= endDate;
        });
    };

    const sortBets = (betsArray, criteria) => {
        // Sorts the array in memory
        return [...betsArray].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);

            switch (criteria) {
                case 'date_desc':
                    return dateB - dateA;
                case 'date_asc':
                    return dateA - dateB;
                case 'stake_desc':
                    return b.stake - a.stake;
                case 'stake_asc':
                    return a.stake - b.stake;
                case 'odds_desc':
                    return b.odds - a.odds;
                case 'odds_asc':
                    return a.odds - b.odds;
                default:
                    return 0;
            }
        });
    };
    
    const displayBetList = (sortedBets) => {
        const betList = document.getElementById('betList');
        if (!betList) return;
        betList.innerHTML = '';
        if (sortedBets.length === 0) {
            betList.innerHTML = '<tr><td colspan="8" class="text-center text-secondary">No bets found for this period.</td></tr>';
            return;
        }

        sortedBets.forEach(bet => {
            const row = document.createElement('tr');
            row.className = 'fade-in';
            const profit = calculateProfitLoss(bet);
            const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'pending-color';
            const statusClass = bet.result.toLowerCase();

            row.innerHTML = `
                <td data-label="Date">${bet.date}</td>
                <td data-label="Sport">${bet.sport}</td>
                <td data-label="Details">${bet.details}</td>
                <td data-label="Stake">${formatCurrency(bet.stake)}</td>
                <td data-label="Odds">${bet.odds.toFixed(2)}</td>
                <td data-label="Result" class="status-cell">
                    <span class="status-badge ${statusClass}">${bet.result}</span>
                </td>
                <td data-label="P/L" class="${profitClass}">${formatCurrency(profit)}</td>
                <td class="action-cell">
                    <button class="action-btn edit-btn" data-id="${bet.id}"><i class="ph-fill ph-note-pencil"></i></button>
                    <button class="action-btn delete-btn" data-id="${bet.id}"><i class="ph-fill ph-trash"></i></button>
                </td>
            `;
            betList.appendChild(row);
        });
    };
    
    const setupEventListeners = () => {
        const betList = document.getElementById('betList');
        const filterControls = document.querySelector('.filter-controls');
        const customDateBtn = document.getElementById('customDateBtn');
        const sortSelector = document.getElementById('sortSelector');
        const closeEditModal = document.getElementById('closeEditModal');
        const editModal = document.getElementById('editModal');
        const editForm = document.getElementById('editBetForm');
        const importFile = document.getElementById('importFile');
        const closeConfirmModal = document.getElementById('closeConfirmModal');
        const confirmBtn = document.getElementById('confirmBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        if (filterControls) {
            filterControls.addEventListener('click', (e) => {
                const target = e.target.closest('.filter-btn');
                if (target) {
                    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                    target.classList.add('active');
                    updateAllUI();
                }
            });
        }
        if (customDateBtn) {
            customDateBtn.addEventListener('click', () => {
                const start = document.getElementById('startDate').value;
                const end = document.getElementById('endDate').value;
                if (start && end) {
                    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                    const customBtn = document.querySelector('.filter-btn[data-period="custom"]');
                    if (customBtn) customBtn.classList.add('active');
                    updateAllUI();
                } else {
                    showNotification("Please select both start and end dates.", "error");
                }
            });
        }
        if (sortSelector) {
            sortSelector.addEventListener('change', (e) => {
                currentSortCriteria = e.target.value;
                updateAllUI();
            });
        }

        if (betList) {
            betList.addEventListener('click', async (e) => {
                const target = e.target.closest('.action-btn');
                if (!target) return;
                const betId = target.dataset.id;
                
                if (target.classList.contains('delete-btn')) {
                    // Use custom modal for confirmation
                    showConfirmModal('Are you sure you want to delete this bet?', async () => {
                        try {
                            const betDocRef = doc(db, `/artifacts/${appId}/users/${userId}/bets`, betId);
                            await deleteDoc(betDocRef);
                            showNotification('Bet deleted successfully.', 'success');
                        } catch (error) {
                            console.error("Error deleting document:", error);
                            showNotification('Failed to delete bet.', 'error');
                        }
                    });
                } else if (target.classList.contains('edit-btn')) {
                    const bet = bets.find(b => b.id === betId);
                    if (bet) {
                        document.getElementById('edit-date').value = bet.date;
                        document.getElementById('edit-sport').value = bet.sport;
                        document.getElementById('edit-details').value = bet.details;
                        document.getElementById('edit-stake').value = bet.stake;
                        document.getElementById('edit-odds').value = bet.odds;
                        document.getElementById('edit-result').value = bet.result;
                        document.getElementById('edit-notes').value = bet.notes;
                        document.getElementById('edit-id').value = bet.id;
                        editModal.style.display = 'flex';
                    }
                }
            });
        }
        if (closeEditModal) closeEditModal.addEventListener('click', () => { editModal.style.display = 'none'; });
        if (editForm) {
            editForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const betId = document.getElementById('edit-id').value;
                const updatedBet = {
                    date: document.getElementById('edit-date').value,
                    sport: document.getElementById('edit-sport').value,
                    details: document.getElementById('edit-details').value,
                    stake: parseFloat(document.getElementById('edit-stake').value),
                    odds: parseFloat(document.getElementById('edit-odds').value),
                    result: document.getElementById('edit-result').value,
                    notes: document.getElementById('edit-notes').value,
                };
                try {
                    const betDocRef = doc(db, `/artifacts/${appId}/users/${userId}/bets`, betId);
                    await updateDoc(betDocRef, updatedBet);
                    editModal.style.display = 'none';
                    showNotification('Bet updated successfully.', 'success');
                } catch (error) {
                    console.error("Error updating document:", error);
                    showNotification('Failed to update bet.', 'error');
                }
            });
        }
        
        if (importFile) {
            importFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const data = new Uint8Array(event.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const json = XLSX.utils.sheet_to_json(worksheet);

                        const validNewBets = json.map(bet => {
                            // Validate and normalize bet data from Excel
                            if (!bet.date || !bet.sport || !bet.details || bet.stake === undefined || bet.odds === undefined) {
                                return null;
                            }
                            return {
                                date: bet.date,
                                sport: bet.sport,
                                details: bet.details,
                                stake: parseFloat(bet.stake),
                                odds: parseFloat(bet.odds),
                                result: bet.result || 'Pending',
                                notes: bet.notes || '',
                            };
                        }).filter(bet => bet !== null);

                        if (validNewBets.length === 0) {
                            showNotification('No valid bets found in the file. Check required fields (date, sport, details, stake, odds).', 'error');
                            return;
                        }

                        // Use custom modal for import confirmation
                        showConfirmModal(`This will add ${validNewBets.length} new bets from the file. Continue?`, async () => {
                             const promises = validNewBets.map(bet => addDoc(betsCollectionRef, bet));
                             try {
                                 await Promise.all(promises);
                                 showNotification(`${validNewBets.length} bets imported successfully.`, 'success');
                                 updateAllUI();
                             } catch (err) {
                                showNotification(`Error importing bets.`, 'error');
                                console.error(err);
                             }
                        });
                    } catch (error) {
                        showNotification('Failed to read the file. Please ensure it is a valid Excel file.', 'error');
                        console.error("Import error:", error);
                    }
                };
                reader.readAsArrayBuffer(file);
                e.target.value = '';
            });
        }

        // Custom modal for confirmation
        function showConfirmModal(message, onConfirm) {
            confirmMessage.textContent = message;
            confirmModal.style.display = 'flex';
            
            const handleConfirm = () => {
                onConfirm();
                confirmModal.style.display = 'none';
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            };

            const handleCancel = () => {
                confirmModal.style.display = 'none';
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
            };

            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            closeConfirmModal.addEventListener('click', handleCancel);
        }
    };
    
    // Run universal setup on all pages
    setLoading(true); // Show loading on initial load
    initUniversalControls();
    
    // Check if on dashboard page and if so, set up event listeners.
    if (document.getElementById('betList') || document.getElementById('addBetForm')) {
        setupEventListeners();
    }
});
