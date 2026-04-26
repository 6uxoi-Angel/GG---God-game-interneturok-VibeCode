(function () {
    const EXT_TO_PAGE_SOURCE = 'JITSI_NAME_EXT';
    const PAGE_TO_EXT_SOURCE = 'JITSI_NAME_PAGE';

    if (window.__jitsiNameBridgeInstalled) {
        return;
    }
    window.__jitsiNameBridgeInstalled = true;

    function resolveNameFromState() {
        const app = window.APP;
        if (!app || !app.store || typeof app.store.getState !== 'function') {
            return { name: null, error: 'APP/store is unavailable' };
        }

        const state = app.store.getState();
        const participants = state && state['features/base/participants'];
        const settings = state && state['features/base/settings'];

        if (settings && typeof settings.displayName === 'string' && settings.displayName.trim()) {
            return { name: settings.displayName.trim(), error: null };
        }

        const myId = app.conference && typeof app.conference.getMyUserId === 'function'
            ? app.conference.getMyUserId()
            : null;

        if (!participants) {
            return { name: null, error: 'participants state is missing' };
        }

        if (Array.isArray(participants)) {
            const me = participants.find((p) => p && (p.local || (myId && p.id === myId)));
            if (me && typeof me.name === 'string' && me.name.trim()) {
                return { name: me.name.trim(), error: null };
            }
        }

        if (participants.local && typeof participants.local.name === 'string' && participants.local.name.trim()) {
            return { name: participants.local.name.trim(), error: null };
        }

        if (participants.participants && myId && participants.participants[myId]) {
            const participant = participants.participants[myId];
            if (participant && typeof participant.name === 'string' && participant.name.trim()) {
                return { name: participant.name.trim(), error: null };
            }
        }

        return { name: null, error: 'name not found in state' };
    }

    function updateName(newName) {
        if (!newName || typeof newName !== 'string') {
            return { success: false, error: 'name is empty' };
        }

        const app = window.APP;
        if (!app) {
            return { success: false, error: 'APP is unavailable' };
        }

        let changed = false;

        try {
            if (app.conference && typeof app.conference.setDisplayName === 'function') {
                app.conference.setDisplayName(newName);
                changed = true;
            }
        } catch (error) {
            console.error('[Injected] conference.setDisplayName failed:', error);
        }

        try {
            if (app.store && typeof app.store.dispatch === 'function') {
                const myId = app.conference && typeof app.conference.getMyUserId === 'function'
                    ? app.conference.getMyUserId()
                    : null;

                app.store.dispatch({
                    type: 'PARTICIPANT_UPDATED',
                    participant: {
                        id: myId,
                        name: newName
                    }
                });
                changed = true;
            }
        } catch (error) {
            console.error('[Injected] store.dispatch failed:', error);
        }

        if (!changed) {
            return { success: false, error: 'could not update name' };
        }

        return { success: true, error: null };
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) {
            return;
        }

        const data = event.data;
        if (!data || data.source !== EXT_TO_PAGE_SOURCE || !data.type || !data.requestId) {
            return;
        }

        if (data.type === 'JITSI_GET_NAME') {
            const result = resolveNameFromState();
            window.postMessage(
                {
                    source: PAGE_TO_EXT_SOURCE,
                    type: 'JITSI_NAME_RESPONSE',
                    requestId: data.requestId,
                    name: result.name,
                    error: result.error
                },
                '*'
            );
            return;
        }

        if (data.type === 'JITSI_SET_NAME') {
            const result = updateName(data.name);
            window.postMessage(
                {
                    source: PAGE_TO_EXT_SOURCE,
                    type: 'JITSI_SET_NAME_RESPONSE',
                    requestId: data.requestId,
                    success: result.success,
                    error: result.error
                },
                '*'
            );
        }
    });
})();
