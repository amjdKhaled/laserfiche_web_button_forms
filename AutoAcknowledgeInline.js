/*
 * Compatibility guard only.
 * The recipient watcher and manager button now live together in
 * ManagerAcknowledgeAction.js so they cannot be deployed with mismatched rules.
 */
(function () {
    "use strict";
    if (typeof window.runManagerAcknowledgeAction !== "function" && window.console) {
        window.console.error("[AutoAck] ManagerAcknowledgeAction.js is not loaded. Check the script tag and browser Network tab.");
    }
}());
