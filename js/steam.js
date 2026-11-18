// Заполняет профиль данными, полученными только с серверной Steam-сессии.
(() => {
    const PERSONA_STATES = {
        0: "Offline",
        1: "Online",
        2: "Busy",
        3: "Away",
        4: "Snooze",
        5: "Looking to trade",
        6: "Looking to play"
    };

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function setOnlineState(element, isOnline) {
        if (!element) return;
        element.classList.toggle("is-online", isOnline);
        element.classList.toggle("is-offline", !isOnline);
    }

    function showNotice(message, type = "info") {
        const notice = document.getElementById("steamNotice");
        if (!notice) return;

        notice.textContent = message;
        notice.dataset.type = type;
        notice.hidden = !message;
    }

    function renderGuest() {
        setText("steamNickname", "Steam не подключён");
        setText("steamStatus", "● Offline");
        setText("steamId", "SteamID: —");
        setText("steamConnectionText", "Steam не подключён");
        setText("steamConnectionStatus", "● Offline");

        const avatar = document.getElementById("steamAvatar");
        if (avatar) avatar.src = "images/avatar-placeholder.svg";

        const profileLink = document.getElementById("steamProfileLink");
        if (profileLink) profileLink.hidden = true;

        const loginButton = document.getElementById("steamLoginButton");
        if (loginButton) loginButton.hidden = false;

        const logoutButton = document.getElementById("steamLogoutButton");
        if (logoutButton) logoutButton.hidden = true;

        setOnlineState(document.getElementById("steamStatus"), false);
        setOnlineState(document.getElementById("steamConnectionStatus"), false);
        showNotice("Чтобы загрузить ник, аватар и SteamID, войдите через Steam.");
    }

    function renderUser(user) {
        const personaState = Number(user.personaState || 0);
        const isOnline = personaState !== 0;
        const statusText = PERSONA_STATES[personaState] || "Online";

        setText("steamNickname", user.name || "Steam Player");
        setText("steamStatus", `● ${statusText}`);
        setText("steamId", `SteamID: ${user.steamId}`);
        setText("steamConnectionText", "Steam подключён");
        setText("steamConnectionStatus", isOnline ? "● Online" : "● Offline");

        const avatar = document.getElementById("steamAvatar");
        if (avatar) {
            avatar.src = user.avatar || "images/avatar-placeholder.svg";
            avatar.alt = `Аватар ${user.name || "Steam Player"}`;
        }

        const profileLink = document.getElementById("steamProfileLink");
        if (profileLink && user.profileUrl) {
            profileLink.href = user.profileUrl;
            profileLink.hidden = false;
        }

        const loginButton = document.getElementById("steamLoginButton");
        if (loginButton) loginButton.hidden = true;

        const logoutButton = document.getElementById("steamLogoutButton");
        if (logoutButton) logoutButton.hidden = false;

        setOnlineState(document.getElementById("steamStatus"), isOnline);
        setOnlineState(document.getElementById("steamConnectionStatus"), isOnline);

        if (user.profileLoaded === false) {
            showNotice("SteamID подтверждён, но ник и аватар пока не загружены. Обновите страницу или перезайдите через Steam. Проверьте STEAM_API_KEY в .env.", "warning");
        } else {
            showNotice("");
        }
    }

    document.addEventListener("DOMContentLoaded", async () => {
        if (!window.DoodropAuth) {
            renderGuest();
            return;
        }

        const user = await window.DoodropAuth.loadUser();
        if (user) renderUser(user);
        else renderGuest();
    });
})();
