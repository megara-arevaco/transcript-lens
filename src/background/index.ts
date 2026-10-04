// Restrict storage before any secret is saved. The panel also awaits this setting.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
