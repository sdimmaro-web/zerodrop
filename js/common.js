// Общие функции DOODROP: баланс и инвентарь привязаны к Steam-аккаунту на сервере.
(() => {
    const DEFAULT_BALANCE = 1000;
    let authRequest = null;
    let currentUser = null; // null = unknown, false = guest, object = logged in

    function paintBalance(value) {
        const safeValue = Math.max(0, Math.round(Number(value) || 0));
        document.querySelectorAll("#balance").forEach((element) => {
            element.textContent = safeValue.toLocaleString("ru-RU") + " ₽";
        });
        const profileBalance = document.getElementById("profileBalance");
        if (profileBalance) {
            profileBalance.textContent = safeValue.toLocaleString("ru-RU") + " ₽";
        }
    }

    function getBalance() {
        if (currentUser && typeof currentUser.balance === "number") {
            return currentUser.balance;
        }
        return DEFAULT_BALANCE;
    }

    async function setBalance(value) {
        const safeValue = Math.max(0, Math.round(Number(value) || 0));
        paintBalance(safeValue);
        if (currentUser && currentUser.authenticated) {
            currentUser.balance = safeValue;
            try {
                await fetch("/api/account", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ action: "set_balance", balance: safeValue })
                });
            } catch (e) {
                console.warn("set balance failed", e);
            }
        }
        return safeValue;
    }

    async function addBalance(amount) {
        const delta = Math.round(Number(amount) || 0);
        if (!currentUser || !currentUser.authenticated) {
            alert("Войдите через Steam, чтобы пополнить баланс");
            location.href = "/auth/steam";
            return getBalance();
        }
        try {
            const res = await fetch("/api/account", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ action: "add_balance", amount: delta })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Ошибка");
            currentUser.balance = data.balance;
            paintBalance(data.balance);
            return data.balance;
        } catch (e) {
            alert(e.message || "Не удалось изменить баланс");
            return getBalance();
        }
    }

    function listInventory() {
        if (currentUser && Array.isArray(currentUser.inventory)) return currentUser.inventory.slice();
        return [];
    }

    function getBestDrop() {
        // Постоянный рекорд аккаунта (не сбрасывается при продаже)
        if (currentUser && currentUser.bestDrop && (Number(currentUser.bestDrop.price) || 0) > 0) {
            return currentUser.bestDrop;
        }
        // fallback для старых сессий
        const items = listInventory();
        if (!items.length) return null;
        return items.reduce((best, it) =>
            (Number(it.price) || 0) > (Number(best.price) || 0) ? it : best
        , items[0]);
    }

    function inventoryValue() {
        return listInventory().reduce((s, it) => s + (Number(it.price) || 0), 0);
    }

    async function sellItem(itemId) {
        if (!currentUser || !currentUser.authenticated) {
            alert("Войдите через Steam");
            location.href = "/auth/steam";
            return null;
        }
        const res = await fetch("/api/account", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ action: "sell_item", item_id: itemId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Не удалось продать");
        currentUser.balance = data.balance;
        currentUser.inventory = data.inventory || [];
        paintBalance(data.balance);
        return data;
    }

    async function sellItems(itemIds) {
        if (!currentUser || !currentUser.authenticated) {
            alert("Войдите через Steam");
            location.href = "/auth/steam";
            return null;
        }
        const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
        const res = await fetch("/api/account", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ action: "sell_items", item_ids: ids })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Не удалось продать");
        currentUser.balance = data.balance;
        currentUser.inventory = data.inventory || [];
        paintBalance(data.balance);
        return data;
    }

    async function openCaseOnServer({ price, item, items, count, caseName, case_price }) {
        if (!currentUser || !currentUser.authenticated) {
            const err = new Error("AUTH_REQUIRED");
            throw err;
        }
        const res = await fetch("/api/account", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
                action: "open_case",
                price,
                item: item || (Array.isArray(items) ? items[0] : null),
                items: Array.isArray(items) ? items : undefined,
                count: count || (Array.isArray(items) ? items.length : 1),
                case_name: caseName || "",
                case_price: case_price || undefined
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Не удалось открыть кейс");
        currentUser.balance = data.balance;
        currentUser.inventory = data.inventory || [];
        if (data.bestDrop !== undefined) currentUser.bestDrop = data.bestDrop;
        currentUser.openedCases = data.openedCases;
        currentUser.moneySpent = data.moneySpent;
        paintBalance(data.balance);
        return data;
    }

    async function loadSteamUser(force = false) {
        if (!force && authRequest) return authRequest;

        authRequest = fetch("/api/me", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json" },
            cache: "no-store"
        })
            .then(async (response) => {
                if (response.status === 401) {
                    currentUser = false;
                    return null;
                }
                if (!response.ok) throw new Error("Не удалось проверить Steam-сессию");
                const data = await response.json();
                currentUser = { authenticated: true, ...data };
                paintBalance(data.balance);
                return currentUser;
            })
            .catch((error) => {
                console.warn("DOODROP Steam:", error.message);
                currentUser = false;
                return null;
            });

        return authRequest;
    }

    function isAuthenticated() {
        return !!(currentUser && currentUser.authenticated);
    }

    function getUser() {
        return isAuthenticated() ? currentUser : null;
    }

    async function requireAuth(message) {
        const user = await loadSteamUser();
        if (!user) {
            alert(message || "Чтобы продолжить, войдите через Steam");
            location.href = "/auth/steam";
            return null;
        }
        return user;
    }

    async function updateAuthControls() {
        const user = await loadSteamUser();

        document.querySelectorAll(".auth-profile-link").forEach((link) => {
            if (user) {
                link.textContent = user.name || "Профиль";
                link.href = "/profile.html";
                link.title = "Открыть профиль";
            } else {
                link.textContent = "Войти через Steam";
                link.href = "/auth/steam";
                link.title = "Авторизация через Steam";
            }
        });

        document.querySelectorAll("[data-auth-only]").forEach((el) => {
            el.style.display = user ? "" : "none";
        });
        document.querySelectorAll("[data-guest-only]").forEach((el) => {
            el.style.display = user ? "none" : "";
        });
    }

    window.DoodropBalance = {
        get: getBalance,
        set: setBalance,
        add: addBalance,
        paint: paintBalance
    };
    window.DoodropAuth = {
        loadUser: loadSteamUser,
        refreshControls: updateAuthControls,
        isAuthenticated,
        getUser,
        require: requireAuth
    };
    window.DoodropInventory = {
        list: listInventory,
        best: getBestDrop,
        value: inventoryValue,
        sell: sellItem,
        sellMany: sellItems
    };
    window.DoodropAccount = {
        openCase: openCaseOnServer
    };

    // —— онлайн на сайте ——
    function ensureOnlineBadge() {
        let el = document.getElementById("onlineBadge");
        if (el) return el;
        const panel = document.querySelector(".user-panel");
        if (!panel) return null;
        el = document.createElement("div");
        el.id = "onlineBadge";
        el.className = "online-badge";
        el.title = "Сейчас на сайте";
        el.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" stroke="#22c55e" stroke-width="1.8"/>' +
            '<path d="M4.5 19.5c.8-3.2 3.4-5 7.5-5s6.7 1.8 7.5 5" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round"/>' +
            '<path d="M18.5 8.5a3 3 0 1 0-1.2-5.7" stroke="#22c55e" stroke-width="1.6" stroke-linecap="round"/>' +
            '<path d="M20.5 14.2c1.4.6 2.3 1.7 2.5 3.3" stroke="#22c55e" stroke-width="1.6" stroke-linecap="round"/>' +
            "</svg>" +
            '<span class="online-count" id="onlineCount">—</span>';
        // вставляем перед балансом
        const balance = panel.querySelector(".balance");
        if (balance) panel.insertBefore(el, balance);
        else panel.prepend(el);
        return el;
    }

    async function refreshOnline() {
        ensureOnlineBadge();
        const countEl = document.getElementById("onlineCount");
        try {
            const res = await fetch("/api/online", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            const data = await res.json();
            if (countEl && typeof data.online === "number") {
                countEl.textContent = Number(data.online).toLocaleString("ru-RU");
            }
        } catch (_) {
            if (countEl && countEl.textContent === "—") countEl.textContent = "1";
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        updateAuthControls();
        ensureOnlineBadge();
        refreshOnline();
        setInterval(refreshOnline, 30000);
    });
})();
