// Injects the floating bottom-left menu button and backdrop that open/close
// .app-sidebar — kept as one shared script instead of duplicating this markup
// and logic across every page, since every page's sidebar is now off-canvas
// by default (see .app-sidebar in style.css) rather than always visible.
(function () {

    function init() {

        const sidebar = document.querySelector(".app-sidebar");

        if (!sidebar) return;

        const backdrop = document.createElement("div");
        backdrop.className = "sidebar-backdrop";
        document.body.appendChild(backdrop);

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "sidebar-toggle-btn";
        toggleBtn.setAttribute("aria-label", "Μενού");
        toggleBtn.innerHTML = "☰";
        document.body.appendChild(toggleBtn);

        function openSidebar() {
            sidebar.classList.add("open");
            backdrop.classList.add("open");
        }

        function closeSidebar() {
            sidebar.classList.remove("open");
            backdrop.classList.remove("open");
        }

        toggleBtn.addEventListener("click", () => {
            if (sidebar.classList.contains("open")) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });

        backdrop.addEventListener("click", closeSidebar);

        sidebar.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeSidebar);
        });

    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
