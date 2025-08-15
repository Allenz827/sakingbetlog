// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, deleteDoc, updateDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// Replace this object with the one from your Firebase project settings
const firebaseConfig = {
    apiKey: "AIzaSyBZx5OLvFRE5m6_cbquG5BWs0TR64V6_40",
    authDomain: "betlog-3bacf.firebaseapp.com",
    projectId: "betlog-3bacf",
    storageBucket: "betlog-3bacf.firebasestorage.app",
    messagingSenderId: "598126173331",
    appId: "1:598126173331:web:8c3cdeed2356fd69c14166"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL STATE & CONFIG ---
    let bets = []; // This will be populated by Firestore
    let profitChart = null;
    let currentTheme = localStorage.getItem('theme') || 'dark'; // Theme is UI-only, so localStorage is fine
    let currentCurrency = JSON.parse(localStorage.getItem('currency')) || { symbol: '₱', code: 'PHP' };
    let currentSortCriteria = 'date_desc';
    let betsCollectionRef; // Will be set after user logs in
    let unsubscribeFromBets; // To detach the Firestore listener
    let isDbReady = false; // Flag to check if Firestore is ready

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
    const loadingOverlay = document.getElementById('loadingOverlay'); // For loading state

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
                if (typeof updateUI === 'function') updateUI();
            });
        }
        if (currencySelector) {
            currencySelector.value = currentCurrency.code;
            currencySelector.addEventListener('change', (e) => {
                currentCurrency = currencies[e.target.value];
                localStorage.setItem('currency', JSON.stringify(currentCurrency));
                if (typeof updateUI === 'function') updateUI();
            });
        }
    };

    // --- FIREBASE AUTHENTICATION & DATA HANDLING ---
    onAuthStateChanged(auth, user => {
        if (user) {
            console.log("User signed in with UID:", user.uid);
            betsCollectionRef = collection(db, "users", user.uid, "bets");
            isDbReady = true;
            setLoading(false); // Hide loading overlay
            listenForBets();
        } else {
            signInAnonymously(auth).catch(error => {
                console.error("Anonymous sign-in failed:", error);
                showNotification("Could not connect to the database.", "error");
                setLoading(false);
            });
        }
    });

    const listenForBets = () => {
        if (unsubscribeFromBets) unsubscribeFromBets();
        
        // Firestore requires an index for compound queries. 
        // For simplicity, we sort on the client-side after fetching.
        // We will still order by date descending by default from Firestore.
        const q = query(betsCollectionRef, orderBy("date", "desc"));

        unsubscribeFromBets = onSnapshot(q, (snapshot) => {
            bets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            if (document.getElementById('profitChart')) {
                updateUI();
            }
        }, error => {
            console.error("Error fetching bets:", error);
            showNotification("Error fetching your bets.", "error");
        });
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
    else {
        const filterButtons = document.querySelectorAll('.filter-btn');
        const customDateBtn = document.getElementById('customDateBtn');
        const sortSelector = document.getElementById('sortSelector');

        const updateUI = () => {
            const activeFilter = document.querySelector('.filter-btn.active');
            const period = activeFilter ? activeFilter.dataset.period : 'all';
            let customDates = {};
            if (period === 'custom') {
                 customDates.start = document.getElementById('startDate').value;
                 customDates.end = document.getElementById('endDate').value;
            }
            const filteredBets = filterBets(period, customDates);
            const sortedBets = sortBets(filteredBets, currentSortCriteria);
            displayStats(filteredBets);
            displayBetList(sortedBets);
            renderProfitChart(filteredBets);
        };

        if (localStorage.getItem('showBetLoggedNotification') === 'true') {
            showNotification('Bet logged successfully!', 'success');
            localStorage.removeItem('showBetLoggedNotification');
        }
        
        const filterBets = (period, customDates = {}) => {
            const now = new Date();
            let startDate, endDate = new Date(now.setHours(23, 59, 59, 999));
            switch (period) {
                case 'today': startDate = new Date(now.setHours(0, 0, 0, 0)); break;
                case 'yesterday':
                    const y = new Date(); y.setDate(y.getDate() - 1);
                    startDate = new Date(y.setHours(0, 0, 0, 0));
                    endDate = new Date(y.setHours(23, 59, 59, 999));
                    break;
                case '7d': startDate = new Date(); startDate.setDate(now.getDate() - 6); startDate.setHours(0,0,0,0); break;
                case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
                case 'year': startDate = new Date(now.getFullYear(), 0, 1); break;
                case 'custom':
                    if (!customDates.start || !customDates.end) return bets;
                    startDate = new Date(customDates.start);
                    endDate = new Date(customDates.end);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                default: return [...bets];
            }
            return bets.filter(bet => {
                const betDate = new Date(bet.date);
                const betUtc = Date.UTC(betDate.getFullYear(), betDate.getMonth(), betDate.getDate());
                const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
                return betUtc >= startUtc && betUtc <= endUtc;
            });
        };

        const sortBets = (betsToSort, criteria) => {
            const sorted = [...betsToSort];
            const resultOrder = { 'Won': 1, 'Lost': 2, 'Pending': 3, 'Void': 4 };
            switch (criteria) {
                case 'date_asc': sorted.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
                case 'result': sorted.sort((a, b) => resultOrder[a.result] - resultOrder[b.result]); break;
                case 'stake_desc': sorted.sort((a, b) => b.stake - a.stake); break;
                case 'stake_asc': sorted.sort((a, b) => a.stake - b.stake); break;
                case 'profit_desc': sorted.sort((a, b) => calculateProfitLoss(b) - calculateProfitLoss(a)); break;
                default: sorted.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
            }
            return sorted;
        };

        const displayStats = (filteredBets) => {
            const settledBets = filteredBets.filter(b => b.result === 'Won' || b.result === 'Lost');
            const turnover = filteredBets.reduce((sum, bet) => sum + bet.stake, 0);
            const netProfit = filteredBets.reduce((sum, bet) => sum + calculateProfitLoss(bet), 0);
            const settledTurnover = settledBets.reduce((sum, bet) => sum + bet.stake, 0);
            const roi = settledTurnover > 0 ? (netProfit / settledTurnover) * 100 : 0;
            const wins = settledBets.filter(b => b.result === 'Won').length;
            const accuracy = settledBets.length > 0 ? (wins / settledBets.length) * 100 : 0;
            const totalBets = filteredBets.length;
            const avgStake = totalBets > 0 ? turnover / totalBets : 0;

            document.getElementById('netProfit').textContent = formatCurrency(netProfit);
            document.getElementById('netProfit').className = netProfit >= 0 ? 'positive' : 'negative';
            document.getElementById('turnover').textContent = formatCurrency(turnover);
            document.getElementById('roi').textContent = `${roi.toFixed(2)}%`;
            document.getElementById('accuracy').textContent = `${accuracy.toFixed(2)}%`;
            document.getElementById('totalBets').textContent = totalBets;
            document.getElementById('avgStake').textContent = formatCurrency(avgStake);
        };
        
        const displayBetList = (sortedBets) => {
            const betList = document.getElementById('betList');
            betList.innerHTML = '';
            if(sortedBets.length === 0 && isDbReady){
                betList.innerHTML = `<tr><td colspan="9" style="text-align:center;">No bets found. Log your first bet!</td></tr>`;
                return;
            }
            sortedBets.forEach(bet => {
                const profit = calculateProfitLoss(bet);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td data-label="Date">${bet.date}</td>
                    <td data-label="Sport">${bet.sport}</td>
                    <td data-label="Details">${bet.details}</td>
                    <td data-label="Stake">${formatCurrency(bet.stake)}</td>
                    <td data-label="Odds">${bet.odds.toFixed(2)}</td>
                    <td data-label="Result" class="result-${bet.result.toLowerCase()}">${bet.result}</td>
                    <td data-label="P/L" class="${profit > 0 ? 'positive' : profit < 0 ? 'negative' : ''}">${formatCurrency(profit)}</td>
                    <td data-label="Notes">${bet.notes || '–'}</td>
                    <td data-label="Actions">
                        <button class="action-btn edit-btn" data-id="${bet.id}"><i class="ph-fill ph-pencil-simple"></i></button>
                        <button class="action-btn delete-btn" data-id="${bet.id}"><i class="ph-fill ph-trash"></i></button>
                    </td>
                `;
                betList.appendChild(row);
            });
        };

        const renderProfitChart = (filteredBets) => {
            const sortedForChart = [...filteredBets].filter(b => b.result !== 'Pending').sort((a, b) => new Date(a.date) - new Date(b.date));
            const labels = [];
            const data = [];
            let cumulativeProfit = 0;
            sortedForChart.forEach(bet => {
                labels.push(bet.date);
                cumulativeProfit += calculateProfitLoss(bet);
                data.push(cumulativeProfit);
            });
            const ctx = document.getElementById('profitChart').getContext('2d');
            const isDark = currentTheme === 'dark';
            const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
            const textColor = isDark ? '#e0e0e0' : '#333';
            if (profitChart) profitChart.destroy();
            profitChart = new Chart(ctx, {
                type: 'line', data: { labels, datasets: [{ label: 'Cumulative Profit', data, borderColor: '#e94560', backgroundColor: 'rgba(233, 69, 96, 0.2)', fill: true, tension: 0.4, pointBackgroundColor: '#e94560', pointBorderColor: '#fff', pointHoverRadius: 7 }] },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { color: textColor, callback: (v) => formatCurrency(v) }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { color: gridColor } } }, plugins: { legend: { labels: { color: textColor } } } }
            });
        };

        // --- EVENT LISTENERS ---
        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                filterButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                updateUI();
            });
        });
        customDateBtn.addEventListener('click', () => {
            const start = document.getElementById('startDate').value;
            const end = document.getElementById('endDate').value;
            if (start && end) {
                filterButtons.forEach(btn => btn.classList.remove('active'));
                const dummy = document.createElement('button');
                dummy.classList.add('active');
                dummy.dataset.period = 'custom';
                customDateBtn.parentNode.appendChild(dummy);
                updateUI();
                dummy.remove();
            } else {
                showNotification("Please select both start and end dates.", "error");
            }
        });
        sortSelector.addEventListener('change', (e) => {
            currentSortCriteria = e.target.value;
            updateUI();
        });
        document.getElementById('betTable').addEventListener('click', async (e) => {
            const targetButton = e.target.closest('.action-btn');
            if (!targetButton) return;
            const betId = targetButton.dataset.id;
            const betDocRef = doc(betsCollectionRef, betId);
            if (targetButton.classList.contains('delete-btn')) {
                if (confirm('Are you sure you want to delete this bet? This action cannot be undone.')) {
                    try {
                        await deleteDoc(betDocRef);
                        showNotification('Bet deleted successfully.', 'success');
                    } catch (error) {
                        showNotification('Failed to delete bet.', 'error');
                        console.error("Delete error:", error);
                    }
                }
            }
            if (targetButton.classList.contains('edit-btn')) {
                openEditModal(betId);
            }
        });
        
        // --- MODAL LOGIC ---
        const modal = document.getElementById('editModal');
        const closeBtn = modal.querySelector('.close-button');
        const editForm = document.getElementById('editForm');
        
        const openEditModal = (betId) => {
            const bet = bets.find(b => b.id === betId);
            if (!bet) return;
            document.getElementById('edit-id').value = bet.id;
            document.getElementById('edit-date').value = bet.date;
            document.getElementById('edit-sport').value = bet.sport;
            document.getElementById('edit-details').value = bet.details;
            document.getElementById('edit-stake').value = bet.stake;
            document.getElementById('edit-odds').value = bet.odds;
            document.getElementById('edit-result').value = bet.result;
            document.getElementById('edit-notes').value = bet.notes;
            modal.classList.add('show');
        };
        
        const closeEditModal = () => modal.classList.remove('show');
        closeBtn.onclick = closeEditModal;
        window.onclick = (event) => { if (event.target == modal) closeEditModal(); };

        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const betId = document.getElementById('edit-id').value;
            const betDocRef = doc(betsCollectionRef, betId);
            const updatedData = {
                date: document.getElementById('edit-date').value,
                sport: document.getElementById('edit-sport').value,
                details: document.getElementById('edit-details').value,
                stake: parseFloat(document.getElementById('edit-stake').value),
                odds: parseFloat(document.getElementById('edit-odds').value),
                result: document.getElementById('edit-result').value,
                notes: document.getElementById('edit-notes').value,
            };
            try {
                await updateDoc(betDocRef, updatedData);
                closeEditModal();
                showNotification('Bet updated successfully!', 'success');
            } catch (error) {
                showNotification('Failed to update bet.', 'error');
                console.error("Update error:", error);
            }
        });

        // --- IMPORT/EXPORT LOGIC ---
        document.getElementById('exportBtn').addEventListener('click', () => {
            if(bets.length === 0) { showNotification('No bets to export.', 'error'); return; }
            const worksheet = XLSX.utils.json_to_sheet(bets.map(({id, ...rest}) => rest));
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Bets");
            XLSX.writeFile(workbook, "BetTracker_Export.xlsx");
        });

        document.getElementById('importFile').addEventListener('change', (e) => {
            if (!isDbReady) {
                showNotification("Database not ready. Please wait a moment and try again.", "error");
                e.target.value = '';
                return;
            }
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { cellDates: true });

                    const validNewBets = json
                        .filter(i => i.date instanceof Date && i.stake != null && i.odds != null && i.result)
                        .map(bet => {
                            const date = new Date(bet.date);
                            const tzoffset = date.getTimezoneOffset() * 60000;
                            const localISOTime = (new Date(date - tzoffset)).toISOString().split('T')[0];
                            return { ...bet, date: localISOTime, stake: parseFloat(bet.stake), odds: parseFloat(bet.odds) };
                        });

                    if (validNewBets.length === 0) {
                        showNotification('No valid bets found in the file. Check date format and required fields.', 'error');
                        return;
                    }

                    if (confirm(`This will add ${validNewBets.length} new bets from the file. Continue?`)) {
                        const promises = validNewBets.map(bet => addDoc(betsCollectionRef, bet));
                        Promise.all(promises).then(() => {
                            showNotification(`${validNewBets.length} bets imported successfully.`, 'success');
                        }).catch(err => {
                             showNotification(`Error importing bets.`, 'error');
                             console.error(err);
                        });
                    }
                } catch (error) {
                    showNotification('Failed to read the file. Please ensure it is a valid Excel file.', 'error');
                    console.error("Import error:", error);
                }
            };
            reader.readAsArrayBuffer(file);
            e.target.value = '';
        });
    }
    
    // Run universal setup on all pages
    setLoading(true); // Show loading on initial load
    initUniversalControls();
});
