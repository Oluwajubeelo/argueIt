let draggedItem = null;
let offsetX = 0;
let offsetY = 0;
let originalParent = null;
let socket = null;
let currentUsername = "";
let lastCursorSend = 0;
const cursors = {};
let localStream = null;
const peerConnections = {};
const rtcConfig = {
    iceServers: [
        {urls: 'stun:stun.l.google.com:19302'},
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};
let inCall = false;
let isMuted = false;
let replyingTo = null;

const urlParams = new URLSearchParams(window.location.search);
if(urlParams.has('room')){
    document.getElementById('join-roomcode').value = urlParams.get('room');
}

function showToast(type, message){
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function handleError(errorCode){
    switch(errorCode){
        case 'NO_USERNAME':
            showToast('error', 'PLEASE ENTER A USERNAME');
            break;

        case 'NO_ROOMCODE':
            showToast('error', 'PLEASE ENTER A ROOM CODE');
            break;

        case 'INVALID_ROOMCODE':
            showToast('error', 'ROOM CODE MUST BE 6 CHARACTERS');
            break;
    }
}

function startReply(sender, text){
    replyingTo = {sender, text};
    document.getElementById('reply-target-name').innerText = sender;
    document.getElementById('reply-target-text').innerText = text.length > 30 ? text.substring(0, 30) + '...' : text;
    document.getElementById('reply-context-area').style.display = 'flex';
    document.getElementById('chat-input').focus();
}

document.getElementById('cancel-reply-btn').addEventListener('click', () => {
    replyingTo = null;
    document.getElementById('reply-context-area').style.display = 'none';
});

function appendChatMessage(sender, text, replyData=null) {
    const chatBox = document.getElementById('chat-messages');
    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'chat-message-wrapper ' + (sender === currentUsername ? 'self' : '');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message ' + (sender === currentUsername ? 'self' : '');

    if (replyData) {
        const replyBlock = document.createElement('div');
        replyBlock.className = 'replied-to-block';
        replyBlock.innerHTML = `<div class="reply-sender">${replyData.sender}</div><div>${replyData.text}</div>`;
        msgEl.appendChild(replyBlock);
    }
    const senderEl = document.createElement('div');
    senderEl.className = 'sender';
    senderEl.innerText = sender;
    const textEl = document.createElement('div');
    textEl.innerText = text;
    msgEl.appendChild(senderEl);
    msgEl.appendChild(textEl);
    const replyBtn = document.createElement('button');
    replyBtn.className = 'reply-icon-btn';
    replyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>`;
    replyBtn.title = "Reply";
    replyBtn.onclick = () => startReply(sender, text);
    wrapperEl.appendChild(msgEl);
    wrapperEl.appendChild(replyBtn);
    chatBox.appendChild(wrapperEl);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function sendChatMessage(){
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(!text) return;

    const currentReplyData = replyingTo ? {...replyingTo} : null;

    appendChatMessage(currentUsername, text, currentReplyData);
    input.value = '';

    if(socket && socket.readyState === WebSocket.OPEN){
        socket.send(JSON.stringify({
            action: 'chat',
            sender: currentUsername,
            text: text,
            replyTo: currentReplyData
        }));
    }

    replyingTo = null;
    document.getElementById('reply-context-area').style.display = 'none';
}

document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) =>{
    if(e.key === 'Enter') sendChatMessage();
});

const toggleChat = () => {
    const chatPanel = document.querySelector('.right-panel');
    chatPanel.classList.toggle('open');
}

document.getElementById('toggle-chat-btn').addEventListener('click', toggleChat);
document.getElementById('close-chat-btn').addEventListener('click', toggleChat);

document.getElementById('call-btn').addEventListener('click', async () => {
    const btn = document.getElementById('call-btn');
    const muteBtn = document.getElementById('mute-btn');

    if(inCall){
        if(localStream){
            localStream.getTracks().forEach(t => t.stop());
        }
        localStream = null;
        inCall = false;
        btn.classList.remove('active');
        muteBtn.style.display = 'none';

        Object.values(peerConnections).forEach(pc => pc.close());
        for (let key in peerConnections) delete peerConnections[key];

        document.querySelectorAll('audio').forEach(a => a.remove());
        showToast('success', 'LEFT VOICE CALL');
        return;
    }

    try{
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        inCall = true;
        btn.classList.add('active');
        muteBtn.style.display = 'flex';

        isMuted = false;
        document.getElementById('mic-icon-unmuted').style.display = 'block';
        document.getElementById('mic-icon-muted').style.display = 'none';
        showToast('success', 'MICROPHONE CONNECTED');
        if(socket && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({action: 'join_call', sender: currentUsername}));
        }
    }
    catch(err){
        console.error("Mic error:", err);
        if(err.name === 'NotAllowedError' || err.name ==='SecurityError'){
            showToast('error', 'MIC BLOCKED: REQUIRES HTTPS OR LOCALHOST');
        }
        else{
            showToast('error', 'MICROPHONE DENIED');
        }
    }
});

document.getElementById('mute-btn').addEventListener('click', () => {
    if(localStream){
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;

        if(isMuted){
            document.getElementById('mic-icon-unmuted').style.display = 'none';
            document.getElementById('mic-icon-muted').style.display = 'block';
            showToast('success', 'MICROPHONE MUTED');
        }
        else{
            document.getElementById('mic-icon-unmuted').style.display = 'block';
            document.getElementById('mic-icon-muted').style.display = 'none';
            showToast('success', 'MICROPHONE UNMUTED');
        }
    }
});

document.getElementById('copy-room-btn').addEventListener('click', () => {
    const code = document.getElementById('display-room-code').innerText;
    const tempInput = document.createElement('input');
    tempInput.value = window.location.origin + "?room=" + code;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showToast('success', 'ROOM LINK COPIED!');
});

document.getElementById('btn-join').addEventListener('click', async () => {
    const username = document.getElementById('join-username').value.trim();
    const roomcode = document.getElementById('join-roomcode').value.trim().toLowerCase();

    if(!username) return handleError('NO_USERNAME');
    if(!roomcode) return handleError('NO_ROOMCODE');
    if(roomcode.length !== 6) return handleError('INVALID_ROOMCODE');

    currentUsername = username;
    connectToRoom(roomcode);
});

document.getElementById('btn-create').addEventListener('click', () => {
    const username = document.getElementById('create-username').value.trim();
    if(!username) return handleError('NO_USERNAME');
    currentUsername = username;
    const newRoomId = Math.random().toString(36).substring(2,8);
    connectToRoom(newRoomId);
});

function createPeerConnection(targetUsername){
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetUsername] = pc;

    if(localStream){
        localStream.getTracks().forEach(track => pc.addTrack(track,localStream));
    }

    pc.onicecandidate = (event) => {
        if(event.candidate && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({
                action: 'webrtc_ice',
                target: targetUsername,
                sender: currentUsername,
                candidate: event.candidate
            }));
        }
    };

    pc.ontrack = (event) =>{
        let audioEl = document.getElementById('audio-' + targetUsername);
        if(!audioEl){
            audioEl = document.createElement('audio');
            audioEl.id = 'audio-' + targetUsername;
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(e => console.error("Audio play failed:", e));
    };
    return pc;
}

function updateRemoteCursor(username, x, y){
    if(username === currentUsername) return;

    if(!cursors[username]){
        const cursorEl = document.createElement('div');
        cursorEl.className = 'remote-cursor';
        cursorEl.innerHTML = `
            <svg viewBox="0 0 16 16"><path d="M0,0 L16,6 L9,9 L6,16 L0,0" /></svg>
            <div class="cursor-name">${username}</div>        
        `;
        document.body.appendChild(cursorEl);
        cursors[username] = {el: cursorEl, timeout: null};
    }

    const cursor = cursors[username];
    cursor.el.style.transform = `translate(${x}px, ${y}px)`;
    cursor.el.style.opacity = '1';

    if(cursor.timeout) clearTimeout(cursor.timeout);
    cursor.timeout = setTimeout(() => {
        cursor.el.style.opacity = '0';
    }, 3000);
}

function connectToRoom(roomId){
    window.history.pushState({}, '', '?room=' + roomId);
    document.title = "ArgueIt - Room: " + roomId;

    document.getElementById('display-room-code').innerText = roomId;
    document.getElementById('landing-page').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    socket = new WebSocket(`${protocol}//${host}/tierlist/${roomId}`);

    socket.onopen = () => {
        console.log(`Connected to Room ${roomId} as ${currentUsername}!`);
        socket.send(JSON.stringify({
            action: 'request_sync',
            sender: currentUsername
        }));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if(data.action === 'chat'){
            appendChatMessage(data.sender, data.text, data.replyTo);
        }
        else if(data.action === 'move'){
            const item = document.querySelector(`[data-item-id="${data.itemId}"]`);
            const targetContainer = document.querySelector(`[data-tier-id="${data.targetTierId}"]`);
            if(item && targetContainer){
                const dropzone = targetContainer.classList.contains('tier-row') ? targetContainer.querySelector('.tier-dropzone') : targetContainer;
                dropzone.appendChild(item);
            }
        }
        else if(data.action === 'add'){
            createImageElement(data.itemId, data.url);
        }
        else if(data.action === 'delete'){
            const item = document.querySelector(`[data-item-id="${data.itemId}"]`);
            if(item) item.remove();
        }
        else if(data.action === 'clear'){
            document.querySelectorAll('.draggable-wrapper').forEach(wrapper => wrapper.remove());
        }
        else if(data.action ==='rename_tier'){
            const tierRow = document.querySelector(`.tier-row[data-tier-id="${data.tierId}"]`);
            if (tierRow){
                const label = tierRow.querySelector('.tier-label');
                if(label && label.innerText !== data.name){
                    label.innerText = data.name;
                }
            }
        }
        else if(data.action === 'cursor'){
            updateRemoteCursor(data.username, data.x, data.y);
        }
        else if (data.action === 'request_sync'){
            const items = [];
            document.querySelectorAll('.draggable-wrapper').forEach(wrapper => {
                const tierId = wrapper.closest('[data-tier-id]').getAttribute('data-tier-id');
                const imgEl = wrapper.querySelector('img');
                if(imgEl){
                    items.push({
                        id: wrapper.getAttribute('data-item-id'),
                        url: imgEl.src,
                        tier: tierId
                    });
                }
            });

            const tiers = {};
            document.querySelectorAll('.tier-label').forEach(label => {
                const tierId = label.closest('.tier-row').getAttribute('data-tier-id');
                tiers[tierId] = label.innerText;
            });

            setTimeout(() => {
                socket.send(JSON.stringify({ action: 'sync_state', items: items, tiers: tiers}));
            }, Math.random() * 500);
        }
        else if(data.action === 'join_call' && data.sender !== currentUsername){
            if(inCall){
                const pc = createPeerConnection(data.sender);
                pc.createOffer().then(offer => {
                    pc.setLocalDescription(offer);
                    socket.send(JSON.stringify({
                        action: 'webrtc_offer',
                        target: data.sender,
                        sender: currentUsername,
                        offer: offer
                    }));
                });
            }
        }
        else if(data.action === 'sync_state'){
            if (data.tiers){
                Object.keys(data.tiers).forEach(tierId => {
                    const label = document.querySelector(`.tier-row[data-tier-id="${tierId}"] .tier-label`);
                    if (label) label.innerText = data.tiers[tierId];
                });
            }

            data.items.forEach(itemData => {
                if(!document.querySelector(`[data-item-id="${itemData.id}"]`)){
                    createImageElement(itemData.id, itemData.url);
                    const  newImg = document.querySelector(`[data-item-id="${itemData.id}"]`);
                    const targetContainer = document.querySelector(`[data-tier-id="${itemData.tier}"]`);

                    if (newImg && targetContainer){
                        const dropzone = targetContainer.classList.contains('tier-row') ? targetContainer.querySelector('.tier-dropzone') : targetContainer;
                        dropzone.appendChild(newImg);
                    }
                }
            });
        }
        else if(data.action === 'webrtc_offer' && data.target === currentUsername){
            const pc = createPeerConnection(data.sender);
            pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            pc.createAnswer().then(answer => {
                pc.setLocalDescription(answer);
                socket.send(JSON.stringify({
                    action: 'webrtc_answer',
                    target: data.sender,
                    sender: currentUsername,
                    answer: answer
                }));
            });
        }
        else if(data.action === 'webrtc_answer' && data.target === currentUsername){
            const pc = peerConnections[data.sender];
            if(pc){
                pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        }
        else if(data.action === 'webrtc_ice' && data.target === currentUsername){
            const pc = peerConnections[data.sender];
            if(pc){
                pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        }
    };

    socket.onclose = () => {
        console.log("Connection asleep. Reconnecting...");
        setTimeout(() => connectToRoom(roomId), 2000);
    }

    if(window.pingInterval) clearInterval(window.pingInterval);
    window.pingInterval = setInterval(() => {
        if(socket && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({action: 'ping'}));
        }
    }, 20000);
}

function broadcastMove(itemId, targetTierId){
    if(socket && socket.readyState === WebSocket.OPEN){
        socket.send(JSON.stringify({
            action: 'move',
            itemId: itemId,
            targetTierId: targetTierId
        }));
    }
}

async function handleUnifiedAction(){
    const query = document.getElementById('unified-input').value.trim();
    if(!query) return showToast('error', 'PLEASE ENTER A SEARCH TERM OR URL');

    const isUrl = /^(https?:\/\/|data:image\/)/i.test(query);
    if(isUrl){
        const uniqueId= 'img-' + Date.now();
        createImageElement(uniqueId, query);
        document.getElementById('unified-input').value = '';
        if(socket && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({action: 'add', itemId: uniqueId, url: query}));
        }
        return;
    }

    const resultsBox = document.getElementById('search-results-container');
    resultsBox.style.display = 'flex';
    resultsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    resultsBox.innerHTML = `
        <div style="display: flex; gap: 12px; width: 100%; padding: 5px;">
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
        </div>
    `;

    try{
        const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=300&format=json&origin=*`);
        const data = await res.json();
        resultsBox.innerHTML = '';

        if(!data.query || !data.query.pages){
            resultsBox.innerHTML = '<span style="color: var(--danger); font-size: 14px; font-weight: bold;">No images found.</span>';
            return;
        }
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕ Close Results';
        closeBtn.style.cssText = 'flex-basis: 100%; background: none; border: none; color: var(--text-secondary); text-align: right; cursor:pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px; transition: color 0.2s;';
        closeBtn.onmouseover = () => closeBtn.style.color = 'var(--danger)';
        closeBtn.onmouseout = () => closeBtn.style.color = 'var(--text-secondary)';
        closeBtn.onclick = () =>resultsBox.style.display = 'none';
        resultsBox.appendChild(closeBtn);

        Object.values(data.query.pages).forEach(page => {
            if(page.imageinfo && page.imageinfo[0]){
                const url = page.imageinfo[0].thumburl || page.imageinfo[0].url;
                const uniqueId = 'img_search_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                const wrapper = createImageElement(uniqueId, url, true);
                resultsBox.appendChild(wrapper);
            }
        });
    }
    catch(err){
        resultsBox.innerHTML = '<span style="color: var(--danger); font-size: 14px; font-weight: bold;">Search failed. Please try again</span>';
    }
}

document.getElementById('unified-action-btn').addEventListener('click', handleUnifiedAction);
document.getElementById('unified-input').addEventListener('keypress', async (e) => {
    if(e.key === 'Enter') await handleUnifiedAction();
});

function createImageElement(id, url, isSearchSource = false){
    const wrapper = document.createElement('div');
    wrapper.className = 'draggable-wrapper' + (isSearchSource ? ' search-source' : '');
    wrapper.setAttribute('data-item-id', id);

    const img= document.createElement('img');
    img.src = url;
    img.className = 'draggable-item';
    img.setAttribute('draggable', 'false');
    img.onerror = () => { wrapper.style.display = 'none';};

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-item-btn';
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    delBtn.title = 'Delete';
    delBtn.onpointerdown = (e) => e.stopPropagation();
    delBtn.onclick = (e) => {
        e.stopPropagation();
        wrapper.remove();
        if(!wrapper.classList.contains('search-source') && socket && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({action: 'delete', itemId: id}));
        }
    };

    wrapper.appendChild(img);
    wrapper.appendChild(delBtn);

    if(!isSearchSource){
        document.getElementById('image-pool').appendChild(wrapper);
    }
    return wrapper;
}

function compressImage(base64Str, callback){
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if(width > height){
            if (width > MAX_WIDTH){
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
        }
        else{
            if(height > MAX_HEIGHT){
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
            }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        callback(canvas.toDataURL('image/jpeg', 0.7));
    }
}

document.addEventListener('paste', (e) => {
    if(e.target.tagName ==='INPUT' || e.target.isContentEditable) return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i = 0; i< items.length; i++){
        if(items[i].type.indexOf('image') !== -1){
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                const rawBase64 = event.target.result;
                compressImage(rawBase64, (compressedBase64) => {
                    const uniqueId = 'img-' + Date.now();
                    createImageElement(uniqueId, compressedBase64);

                    if(socket && socket.readyState === WebSocket.OPEN){
                        socket.send(JSON.stringify({action: 'add', itemId:uniqueId, url: compressedBase64}));
                    }
                    showToast('success', 'IMAGE PASTED!');
                });
            };
            reader.readAsDataURL(blob);
            e.preventDefault();
            break;
        }
    }
});

document.getElementById('clear-board-btn').addEventListener('click', () => {
    document.querySelectorAll('.draggable-wrapper').forEach(wrapper => wrapper.remove());

    if (socket && socket.readyState === WebSocket.OPEN){
        socket.send(JSON.stringify({action: 'clear'}));
    }
});

document.querySelectorAll('.tier-label').forEach(label => {
    label.addEventListener('blur', () => {
        const tierId = label.closest('.tier-row').getAttribute('data-tier-id');
        const newName = label.innerText;
        if(socket && socket.readyState === WebSocket.OPEN){
            socket.send(JSON.stringify({action: 'rename_tier', tierId: tierId, name: newName}));
        }
    });

    label.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
    });
});

document.addEventListener('pointerdown', (e) => {
    const wrapper = e.target.closest('.draggable-wrapper');
    if(wrapper && !e.target.closest('.delete-item-btn')){
        draggedItem = wrapper;
        originalParent = draggedItem.parentElement;

        const rect = draggedItem.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        document.body.appendChild(draggedItem);
        draggedItem.style.position = 'absolute';
        draggedItem.style.zIndex = '1000';
        draggedItem.style.left = `${e.pageX - offsetX}px`;
        draggedItem.style.top = `${e.pageY - offsetY}px`;
        draggedItem.setPointerCapture(e.pointerId);
    }
});

document.addEventListener('pointermove', (e) => {
    if(draggedItem){
        draggedItem.style.left = `${e.pageX - offsetX}px`;
        draggedItem.style.top = `${e.pageY - offsetY}px`;
    }

    if(socket && socket.readyState === WebSocket.OPEN && document.getElementById('app-container').style.display !== 'none'){
        const now = Date.now();
        if(now - lastCursorSend > 50){
            socket.send(JSON.stringify({action: 'cursor', username: currentUsername, x: e.pageX, y: e.pageY}));
            lastCursorSend = now;
        }
    }
});

document.addEventListener('pointerup', (e) => {
    if(draggedItem){
        draggedItem.style.display = 'none';
        const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
        draggedItem.style.display = '';
        const dropzone = elementBelow ? elementBelow.closest('.tier-dropzone') : null;
        draggedItem.style.position = '';
        draggedItem.style.zIndex = '';
        draggedItem.style.left = '';
        draggedItem.style.top = '';

        if(dropzone){
            const targetTierId = dropzone.closest('[data-tier-id]').getAttribute('data-tier-id');
            const itemId = draggedItem.getAttribute('data-item-id');

            if(draggedItem.classList.contains('search-source')){
                draggedItem.classList.remove('search-source');
                const imgUrl = draggedItem.querySelector('img').src;
                if(socket && socket.readyState === WebSocket.OPEN){
                    socket.send(JSON.stringify({action: 'add', itemId: itemId, url: imgUrl}));
                }
            }
            dropzone.appendChild(draggedItem);
            broadcastMove(itemId, targetTierId);
        }
        else{
            originalParent.appendChild(draggedItem);
        }
        draggedItem.releasePointerCapture(e.pointerId);
        draggedItem = null;
        originalParent = null;
    }
});

document.getElementById('search-image-btn').addEventListener('click', async () =>{
    const query = document.getElementById('image-search-input').value.trim();
    if(!query) return showToast('error', 'PLEASE ENTER A SEARCH TERM');

    const resultsBox = document.getElementById('search-results-container');
    resultsBox.style.display = 'flex';
    resultsBox.innerHTML = `
        <div style="display: flex; gap: 10px; width: 100%; padding: 5px;">
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
            <div class="pulse-box"></div>
        </div>
    `;

    try{
        const res = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=300&format=json&origin=*`);
        const data = await res.json();
        resultsBox.innerHTML = '';

        if(!data.query || !data.query.pages){
            resultsBox.innerHTML = '<span style="color: #ff4444; font-size: 14px;">No images found.</span>';
            return;
        }
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕ Close Results';
        closeBtn.style.cssText = 'flex-basis: 100%; background: none; border: none; color: #ff4444; text-align: right; cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;';
        closeBtn.onclick = () => resultsBox.style.display = 'none';
        resultsBox.appendChild(closeBtn);

        Object.values(data.query.pages).forEach(page => {
            if(page.imageinfo && page.imageinfo[0]){
                const url = page.imageinfo[0].thumburl || page.imageinfo[0].url;
                const uniqueId = 'img_search_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                const img = document.createElement('img');
                img.src = url;
                img.className = 'draggable-item search-source';
                img.setAttribute('data-item-id', uniqueId);
                img.setAttribute('draggable', 'false');
                img.onerror = () => {img.style.display = 'none';};
                resultsBox.appendChild(img);
            }
        });
    }
    catch(err){
        resultsBox.innerHTML = '<span style="color: #ff4444; font-size: 14px;">Search failed. Please try again.</span>';
    }
});

