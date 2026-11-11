/**
 * H3 Storyboard Studio - Workspace Synchronization Controller
 * 
 * Subscribes to local h3_server daemon (/api/workspace-sync), synchronizing
 * pipeline progress, display/spoken dual-track dialogues, and ShotLock concurrency states.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.H3WorkspaceSync = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  let syncTimer = null;
  let activeProjectId = "";
  const listeners = new Set();

  function fetchWorkspaceSync(projectId, daemonUrl) {
    const base = daemonUrl || "http://127.0.0.1:8080";
    const url = `${base}/api/workspace-sync?project_id=${encodeURIComponent(projectId)}`;

    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        if (data.ok) {
          applyWorkspaceSync(data);
          notifyListeners(data);
        }
        return data;
      })
      .catch(function (err) {
        console.debug("[WorkspaceSync] Daemon unreachable or error:", err.message);
        return null;
      });
  }

  function applyWorkspaceSync(data) {
    if (!data) return;

    // 1. Update shot lock status in UI
    const locks = data.shot_locks || {};
    Object.keys(locks).forEach(function (key) {
      // key is like shot_0
      const match = key.match(/shot_(\d+)/);
      if (match) {
        const shotIdx = match[1];
        updateShotLockUI(shotIdx, true, locks[key]);
      }
    });

    // 2. Update telemetry badges if telemetry is present
    if (data.telemetry && data.telemetry.estimated) {
      updateTelemetryUI(data.telemetry);
    }
  }

  function updateShotLockUI(shotIndex, isLocked, lockInfo) {
    const singleBtn = document.querySelector(`button[onclick*="triggerRerollExecution(${shotIndex}, 'single')"]`);
    const cascadeBtn = document.querySelector(`button[onclick*="triggerRerollExecution(${shotIndex}, 'cascade')"]`);

    [singleBtn, cascadeBtn].forEach(function (btn) {
      if (btn) {
        btn.disabled = isLocked;
        if (isLocked) {
          btn.dataset.origText = btn.dataset.origText || btn.textContent;
          btn.textContent = "🔒 鎖定生成中";
          btn.style.opacity = "0.6";
        } else if (btn.dataset.origText) {
          btn.textContent = btn.dataset.origText;
          btn.style.opacity = "1";
        }
      }
    });
  }

  function updateTelemetryUI(telemetry) {
    const badge = document.getElementById("h3-telemetry-badge");
    if (!badge) return;

    const est = telemetry.estimated || {};
    const conf = est.eta_confidence || "low";
    badge.textContent = `⏱️ ETA: ${est.remaining_minutes || 0}m (${conf} 信賴)`;
  }

  function notifyListeners(data) {
    listeners.forEach(function (fn) {
      try {
        fn(data);
      } catch (e) {
        console.warn("[WorkspaceSync] listener error:", e);
      }
    });
  }

  function startSync(projectId, intervalMs, daemonUrl) {
    stopSync();
    activeProjectId = projectId || "fc_detective_25s_demo";
    const interval = intervalMs || 3000;

    fetchWorkspaceSync(activeProjectId, daemonUrl);
    syncTimer = setInterval(function () {
      fetchWorkspaceSync(activeProjectId, daemonUrl);
    }, interval);
  }

  function stopSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  return {
    startSync: startSync,
    stopSync: stopSync,
    fetchWorkspaceSync: fetchWorkspaceSync,
    applyWorkspaceSync: applyWorkspaceSync,
    updateShotLockUI: updateShotLockUI,
    updateTelemetryUI: updateTelemetryUI,
    subscribe: function (fn) {
      listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    }
  };
});
