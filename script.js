document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL STATE & CONFIG ---
    let bets = JSON.parse(localStorage.getItem('bets')) || [];
    let profitChart = null;
    let currentTheme = localStorage.getItem('theme') || 'dark'; // Default to dark theme
    let currentCurrency = JSON.parse(localStorage.getItem('currency')) || { symbol: '₱', code: 'PHP' };
    let currentSortCriteria = 'date_desc';

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

    // --- HELPER FUNCTIONS ---

    /**
     * Gets the current date in Manila (GMT+8) as a 'YYYY-MM-DD' string.
     * @returns {string} The formatted date string.
     */
    const getManilaDateString = () => {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const manilaTime = new Date(utc + (3600000 * 8));
        return manilaTime.toISOString().split('T')[0];
    };

    /**
     * Formats a number as currency.
     * @param {number} amount The amount to format.
     * @returns {string} The formatted currency string.
     */
    const formatCurrency = (amount) => {
        return `${currentCurrency.symbol}${amount.toFixed(2)}`;
    };

    /**
     * Calculates the profit or loss for a given bet.
     * @param {object} bet The bet object.
     * @returns {number} The calculated profit or loss.
     */
    const calculateProfitLoss = (bet) => {
        if (bet.result === 'Won') return (bet.stake * bet.odds) - bet.stake;
        if (bet.result === 'Lost') return -bet.stake;
        return 0; // for 'Pending' or 'Void'
    };
    
    /**
     * Shows a notification message.
     * @param {string} message The message to display.
     * @param {string} type 'success' or 'error'.
     */
    const showNotification = (message, type = 'success') => {
        notificationMessage.textContent = message;
        notificationElement.className = 'notification glass-card'; // Reset classes
        notificationElement.classList.add(type);
        notificationContainer.classList.add('show');
        setTimeout(() => {
            notificationContainer.classList.remove('show');
        }, 3000);
    };

    // --- THEME & CURRENCY ---

    /**
     * Applies the selected theme to the document.
     * @param {string} theme The theme to apply ('light' or 'dark').
     */
    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        // If the theme is light, show the moon icon (to switch to dark), and vice-versa.
        const icon = theme === 'light' ? 'ph-fill ph-moon' : 'ph-fill ph-sun';
        if (themeSwitcher) {
            themeSwitcher.innerHTML = `<i class="${icon}"></i>`;
        }
    };

    const initUniversalControls = () => {
        applyTheme(currentTheme);
        if (themeSwitcher) {
            themeSwitcher.addEventListener('click', () => {
                currentTheme = currentTheme === 'light' ? 'dark' : 'light';
                localStorage.setItem('theme', currentTheme);
                applyTheme(currentTheme);
                
                // If the updateUI function exists (i.e., we're on the dashboard page), call it
                // to re-render the chart with the new theme's colors.
                if (typeof updateUI === 'function') {
                    updateUI();
                }
            });
        }

        if (currencySelector) {
            currencySelector.value = currentCurrency.code;
            currencySelector.addEventListener('change', (e) => {
                currentCurrency = currencies[e.target.value];
                localStorage.setItem('currency', JSON.stringify(currentCurrency));
                if (typeof updateUI === 'function') {
                    updateUI(); 
                }
            });
        }
    };

    // --- PAGE-SPECIFIC LOGIC ---

    // ADD BET PAGE
    if (document.getElementById('addBetForm')) {
        const addBetForm = document.getElementById('addBetForm');
        const betDateInput = document.getElementById('betDate');
        
        // Set default date to Manila time
        betDateInput.value = getManilaDateString();

        addBetForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const newBet = {
                id: Date.now(),
                date: document.getElementById('betDate').value,
                sport: document.getElementById('sport').value,
                details: document.getElementById('betDetails').value,
                stake: parseFloat(document.getElementById('stake').value),
                odds: parseFloat(document.getElementById('odds').value),
                result: document.getElementById('result').value,
                notes: document.getElementById('notes').value,
            };
            bets.unshift(newBet); // Add to the beginning of the array
            localStorage.setItem('bets', JSON.stringify(bets));
            
            // Store a flag to show notification on the next page
            localStorage.setItem('showBetLoggedNotification', 'true');
            window.location.href = 'index.html';
        });
    } 
    // DASHBOARD PAGE
    else {
        // --- DASHBOARD INITIALIZATION ---
        const filterButtons = document.querySelectorAll('.filter-btn');
        const customDateBtn = document.getElementById('customDateBtn');
        const sortSelector = document.getElementById('sortSelector');

        // This function is only defined on the dashboard page
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

            displayStats(filteredBets); // Stats should be based on filter, not sort
            displayBetList(sortedBets);
            renderProfitChart(filteredBets); // Chart should be chronological, not sorted
        };

        // Check if we need to show a notification after adding a bet
        if (localStorage.getItem('showBetLoggedNotification') === 'true') {
            showNotification('Bet logged successfully!', 'success');
            localStorage.removeItem('showBetLoggedNotification');
        }
        
        const filterBets = (period, customDates = {}) => {
            const now = new Date();
            let startDate, endDate = new Date(now.setHours(23, 59, 59, 999));

            switch (period) {
                case 'today':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'yesterday':
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    startDate = new Date(yesterday.setHours(0, 0, 0, 0));
                    endDate = new Date(yesterday.setHours(23, 59, 59, 999));
                    break;
                case '7d':
                    startDate = new Date();
                    startDate.setDate(now.getDate() - 6);
                    startDate.setHours(0,0,0,0);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
                case 'custom':
                    if (!customDates.start || !customDates.end) return bets;
                    startDate = new Date(customDates.start);
                    endDate = new Date(customDates.end);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'all':
                default:
                    return [...bets]; // Return a copy
            }

            return bets.filter(bet => {
                const betDate = new Date(bet.date);
                // Adjust for timezone differences by comparing date parts only
                const betUtc = Date.UTC(betDate.getFullYear(), betDate.getMonth(), betDate.getDate());
                const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
                const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
                return betUtc >= startUtc && betUtc <= endUtc;
            });
        };

        const sortBets = (betsToSort, criteria) => {
            const sorted = [...betsToSort]; // Create a copy to sort
            const resultOrder = { 'Won': 1, 'Lost': 2, 'Pending': 3, 'Void': 4 };

            switch (criteria) {
                case 'date_asc':
                    sorted.sort((a, b) => new Date(a.date) - new Date(b.date));
                    break;
                case 'result':
                    sorted.sort((a, b) => resultOrder[a.result] - resultOrder[b.result]);
                    break;
                case 'stake_desc':
                    sorted.sort((a, b) => b.stake - a.stake);
                    break;
                case 'stake_asc':
                    sorted.sort((a, b) => a.stake - b.stake);
                    break;
                case 'profit_desc':
                    sorted.sort((a, b) => calculateProfitLoss(b) - calculateProfitLoss(a));
                    break;
                case 'date_desc':
                default:
                    sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
                    break;
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
            if(sortedBets.length === 0){
                betList.innerHTML = `<tr><td colspan="9" style="text-align:center;">No bets found.</td></tr>`;
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
            const sortedForChart = [...filteredBets]
                .filter(b => b.result !== 'Pending')
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            
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

            if (profitChart) {
                profitChart.destroy();
            }
            profitChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Cumulative Profit',
                        data: data,
                        borderColor: '#e94560',
                        backgroundColor: 'rgba(233, 69, 96, 0.2)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#e94560',
                        pointBorderColor: '#fff',
                        pointHoverRadius: 7,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            ticks: { color: textColor, callback: (value) => formatCurrency(value) },
                            grid: { color: gridColor }
                        },
                        x: {
                            ticks: { color: textColor },
                            grid: { color: gridColor }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: textColor } }
                    }
                }
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
                // Create a dummy active button for custom logic
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

        document.getElementById('betTable').addEventListener('click', (e) => {
            const targetButton = e.target.closest('.action-btn');
            if (!targetButton) return;

            const betId = parseInt(targetButton.dataset.id);
            if (targetButton.classList.contains('delete-btn')) {
                 if (confirm('Are you sure you want to delete this bet? This action cannot be undone.')) {
                    bets = bets.filter(b => b.id !== betId);
                    localStorage.setItem('bets', JSON.stringify(bets));
                    updateUI();
                    showNotification('Bet deleted successfully.', 'success');
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
        window.onclick = (event) => {
            if (event.target == modal) {
                closeEditModal();
            }
        };

        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const betId = parseInt(document.getElementById('edit-id').value);
            const betIndex = bets.findIndex(b => b.id === betId);
            
            if (betIndex !== -1) {
                bets[betIndex] = {
                    id: betId,
                    date: document.getElementById('edit-date').value,
                    sport: document.getElementById('edit-sport').value,
                    details: document.getElementById('edit-details').value,
                    stake: parseFloat(document.getElementById('edit-stake').value),
                    odds: parseFloat(document.getElementById('edit-odds').value),
                    result: document.getElementById('edit-result').value,
                    notes: document.getElementById('edit-notes').value,
                };
                localStorage.setItem('bets', JSON.stringify(bets));
                closeEditModal();
                updateUI();
                showNotification('Bet updated successfully!', 'success');
            }
        });

        // --- IMPORT/EXPORT LOGIC ---
        document.getElementById('exportBtn').addEventListener('click', () => {
            if(bets.length === 0) {
                showNotification('No bets to export.', 'error');
                return;
            }
            const worksheet = XLSX.utils.json_to_sheet(bets);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Bets");
            XLSX.writeFile(workbook, "BetTracker_Export.xlsx");
        });

        document.getElementById('importFile').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet);

                    const validNewBets = json.filter(item => 
                        item.date && item.stake != null && item.odds != null && item.result
                    ).map(item => ({...item, id: Date.now() + Math.random() })); // Add unique IDs

                    if (validNewBets.length === 0) {
                        showNotification('No valid bets found in the file.', 'error');
                        return;
                    }

                    if (confirm(`This will add ${validNewBets.length} new bets from the file. Continue?`)) {
                        bets = [...validNewBets, ...bets]; // Prepend new bets
                        localStorage.setItem('bets', JSON.stringify(bets));
                        updateUI();
                        showNotification(`${validNewBets.length} bets imported successfully.`, 'success');
                    }
                } catch (error) {
                    showNotification('Failed to read the file. Please ensure it is a valid Excel file.', 'error');
                    console.error("Import error:", error);
                }
            };
            reader.readAsArrayBuffer(file);
            e.target.value = ''; // Reset file input
        });

        // --- INITIAL LOAD ---
        updateUI();
    }
    
    // Run universal setup on all pages
    initUniversalControls();
});
