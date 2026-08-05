/**
 * DOMScanner Real-time WebSocket Hub
 * Handles encrypted WebSocket connections for Browser Clients & Desktop Agents.
 */

const { WebSocketServer, WebSocket } = require('ws');
const url   = require('url');
const db    = require('./db');
const auth  = require('./auth');

// In-memory sockets storage
// Map<agentId (number), WebSocket>
const agentSockets = new Map();
// Map<userId (number), Set<WebSocket>>
const clientSockets = new Map();

function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle Upgrade HTTP request
  server.on('upgrade', async (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    const pathname  = parsedUrl.pathname;

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, parsedUrl.query);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, request, query) => {
    const type  = query.type; // 'agent' or 'client'
    const key   = query.key;  // agent key
    const token = query.token;// client JWT token

    if (type === 'agent' && key) {
      // ── Agent Connection ──
      let agent = await db.getAgentByKey(key);
      if (!agent) {
        // Auto-adopt agent on the fly for guest session (handles server restarts gracefully)
        const guestUserId = (require('./guest-session')).getGuestUserId() || 1;
        const agentName   = (query.agentName || 'Desktop Agent').trim();
        agent = await db.createAgent(guestUserId, agentName, key);
        console.log(`✨ Auto-adopted agent: "${agentName}" (ID: ${agent.id})`);
      }

      ws.agentId = agent.id;
      ws.userId  = agent.user_id;
      ws.isAlive = true;

      agentSockets.set(agent.id, ws);
      await db.updateAgentStatus(agent.id, 'online', query.osInfo, query.localIp, query.version);
      notifyUserAgentsChanged(agent.user_id);

      console.log(`🔌 Agent connected: "${agent.agent_name}" (ID: ${agent.id}, Key: ${key.slice(0, 15)}...)`);

      ws.send(JSON.stringify({
        type: 'welcome_agent',
        agentId: agent.id,
        agentName: agent.agent_name,
        status: 'online',
      }));

      ws.on('message', async (message) => {
        ws.isAlive = true;
        try {
          const payload = JSON.parse(message.toString());
          handleAgentMessage(ws, agent, payload);
        } catch (err) {
          console.error('Agent WS message error:', err.message);
        }
      });

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('ping', () => { ws.isAlive = true; });

      ws.on('close', async () => {
        if (agentSockets.get(agent.id) === ws) {
          agentSockets.delete(agent.id);
          await db.updateAgentStatus(agent.id, 'offline');
          notifyUserAgentsChanged(agent.user_id);
          console.log(`🔌 Agent disconnected: "${agent.agent_name}" (ID: ${agent.id})`);
        }
      });

    } else if (type === 'client' && token) {
      // ── Browser Client Connection ──
      const decoded = auth.verifyAccessToken(token);
      if (!decoded) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized client token' }));
        return ws.close(4002, 'Unauthorized');
      }

      const userId = decoded.userId;
      ws.userId = userId;

      if (!clientSockets.has(userId)) clientSockets.set(userId, new Set());
      clientSockets.get(userId).add(ws);

      console.log(`💻 Browser Client connected for User ID: ${userId}`);

      ws.send(JSON.stringify({ type: 'welcome_client', userId }));

      ws.on('message', async (message) => {
        try {
          const payload = JSON.parse(message.toString());
          handleClientMessage(ws, userId, payload);
        } catch (err) {
          console.error('Client WS message error:', err.message);
        }
      });

      ws.on('close', () => {
        if (clientSockets.has(userId)) {
          clientSockets.get(userId).delete(ws);
          if (clientSockets.get(userId).size === 0) clientSockets.delete(userId);
        }
      });

    } else {
      ws.close(4000, 'Invalid parameters');
    }
  });

  // Heartbeat ping interval to prune stale connections (every 45s)
  const interval = setInterval(async () => {
    for (const [agentId, ws] of agentSockets.entries()) {
      if (ws.isAlive === false) {
        agentSockets.delete(agentId);
        await db.updateAgentStatus(agentId, 'offline');
        if (ws.userId) notifyUserAgentsChanged(ws.userId);
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 45000);

  wss.on('close', () => clearInterval(interval));
}

// ── Agent Message Handler ──
async function handleAgentMessage(ws, agent, payload) {
  ws.isAlive = true;
  if (payload.type === 'heartbeat') {
    await db.updateAgentStatus(agent.id, 'online', payload.osInfo, payload.localIp, payload.version);
    notifyUserAgentsChanged(agent.user_id);
    return;
  }

  // Forward scan events (start, progress, device, done, error) to browser client
  if (payload.type === 'scan_event') {
    const userId = agent.user_id;

    // Stream event to connected browser client sockets for this user
    broadcastToUser(userId, {
      type: 'scan_stream',
      agentId: agent.id,
      agentName: agent.agent_name,
      event: payload.event,
      data: payload.data,
    });

    // When scan completes, save result in DB
    if (payload.event === 'done' && payload.data && payload.data.devices) {
      await db.saveScanHistory(
        userId,
        agent.id,
        agent.agent_name,
        payload.data.subnet || 'Remote Subnet',
        payload.data.devices
      );
    }
  }

  // Forward port scan results to browser client
  if (payload.type === 'portscan_result') {
    broadcastToUser(agent.user_id, {
      type: 'portscan_result',
      agentId: agent.id,
      data: payload.data,
    });
  }
}

// ── Client Message Handler ──
async function handleClientMessage(ws, userId, payload) {
  if (payload.action === 'start_scan') {
    const agentId = payload.agentId;
    const agentWs = agentSockets.get(agentId);

    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'scan_error',
        agentId,
        message: 'Agent is offline or disconnected',
      }));
      return;
    }

    // Verify agent belongs to user
    const agentObj = await db.getAgentById(agentId);
    if (!agentObj || String(agentObj.user_id) !== String(userId)) {
      ws.send(JSON.stringify({ type: 'scan_error', agentId, message: 'Unauthorized agent selection' }));
      return;
    }

    // Command agent to start scan
    agentWs.send(JSON.stringify({
      command: 'start_scan',
      scanId: Date.now(),
    }));

    ws.send(JSON.stringify({
      type: 'scan_initiated',
      agentId,
      agentName: agentObj.agent_name,
    }));
  }

  if (payload.action === 'port_scan') {
    const agentId = payload.agentId;
    const agentWs = agentSockets.get(agentId);

    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({
        command: 'port_scan',
        ip: payload.ip,
        profile: payload.profile,
        customPorts: payload.customPorts,
      }));
    }
  }
}

function broadcastToUser(userId, messageObj) {
  const numId = Number(userId);
  const strId = String(userId);
  const set1 = clientSockets.get(numId);
  const set2 = clientSockets.get(strId);
  const targets = new Set([...(set1 || []), ...(set2 || [])]);

  if (targets.size > 0) {
    const msgStr = JSON.stringify(messageObj);
    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msgStr);
      }
    }
  }
}

async function notifyUserAgentsChanged(userId) {
  const agents = await db.getAgentsByUserId(userId);
  broadcastToUser(userId, { type: 'agents_updated', agents });
}

module.exports = {
  attachWebSocketServer,
  agentSockets,
  clientSockets,
  broadcastToUser,
};
