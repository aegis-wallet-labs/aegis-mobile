import { getAuthHeaders } from './qoreWallet';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://aegis-ai-api.fly.dev';
const CHAT_STATUS_PREFIX = '__AEGIS_STATUS__:';

type ChatStatus = {
  title: string;
  detail: string;
  tone: 'success' | 'error' | 'neutral';
};

/** Remaining daily chat credits for this wallet (null when unknown/offline). */
export async function fetchCredits(wallet) {
  if (!API_BASE_URL || !wallet?.mnemonic) return null;
  try {
    const headers = await getAuthHeaders(wallet.mnemonic);
    const response = await fetch(
      `${API_BASE_URL}/api/chat/credits/${headers['x-aegis-address']}`,
      { headers },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.creditsRemaining === 'number' ? data.creditsRemaining : null;
  } catch {
    return null;
  }
}

/** New client-side conversation id — created the moment a fresh chat sends its first message. */
export function newConversationId() {
  return `conv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Messages of one saved conversation (empty on any failure). */
export async function fetchChatHistory(wallet, conversationId) {
  if (!API_BASE_URL || !wallet?.mnemonic || !conversationId) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const headers = await Promise.race([
      getAuthHeaders(wallet.mnemonic),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Timed out loading chat.')))),
    ]);
    const response = await fetch(
      `${API_BASE_URL}/api/chat/history/${headers['x-aegis-address']}?conversation=${encodeURIComponent(conversationId)}`,
      { headers, signal: controller.signal },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      if (row.role !== 'user' && typeof row.content === 'string' && row.content.startsWith(CHAT_STATUS_PREFIX)) {
        try {
          const statusCard = JSON.parse(row.content.slice(CHAT_STATUS_PREFIX.length));
          if (typeof statusCard?.title === 'string' && typeof statusCard?.detail === 'string' &&
            ['success', 'error', 'neutral'].includes(statusCard?.tone)) {
            return { role: 'agent', statusCard, source: 'server' };
          }
        } catch {
          // Fall through to render the stored content if an old record is malformed.
        }
      }
      return { role: row.role === 'user' ? 'user' : 'agent', content: row.content, source: 'server' };
    });
  } catch { return []; } finally { clearTimeout(timeout); }
}

/** Persist a local transaction outcome without invoking the agent or consuming a chat credit. */
export async function saveChatStatus(wallet, conversationId: string | null, status: ChatStatus) {
  if (!API_BASE_URL || !wallet?.mnemonic || !conversationId) return;
  try {
    const headers = await getAuthHeaders(wallet.mnemonic);
    await fetch(`${API_BASE_URL}/api/chat/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ conversationId, status }),
    });
  } catch {
    // The visible card remains useful even if the history write is offline.
  }
}
/** Recent conversations for the side menu: [{ id, title, lastAt }], newest first. */
export async function fetchConversations(wallet) {
  if (!API_BASE_URL || !wallet?.mnemonic) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const headers = await Promise.race([
      getAuthHeaders(wallet.mnemonic),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Timed out loading chat.')))),
    ]);
    const response = await fetch(
      `${API_BASE_URL}/api/chat/conversations/${headers['x-aegis-address']}`,
      { headers },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows.filter((row) => row?.id && row?.title) : [];
  } catch {
    return [];
  }
}

export const starterPrompts = [
  'Transfer 100 QOR tokens',
  'Swap 1200 QOR to QUSDT',
  'Show my wallet addresses',
];

function localAgentReply(text, wallet) {
  const lower = text.toLowerCase();
  if (lower.includes('swap')) {
    return 'I can prepare a swap when the amount and token pair are clear. You will review and sign before anything is submitted.';
  }
  if (lower.includes('bridge') || lower.includes('cross')) {
    return 'I can prepare a bridge transfer by checking the destination chain, address, token, and amount before you confirm.';
  }
  if (lower.includes('send') || lower.includes('transfer')) {
    const hasAddress = /\b(qor1[a-z0-9]{8,}|0x[a-f0-9]{40})\b/i.test(text);
    const hasAmount = /\b\d+(?:\.\d+)?\b/.test(text);
    if (hasAmount && !hasAddress) return 'Sure. What wallet address should I send it to?';
    return 'I can prepare a QOR transfer by checking the recipient, amount, and memo before you confirm.';
  }
  if (lower.includes('address') || lower.includes('wallet')) {
    return `Your wallet has three derived accounts:\nNative: ${wallet.accounts.native.address}\nEVM: ${wallet.accounts.evm.address}\nSVM: ${wallet.accounts.svm.address}`;
  }
  if (lower.includes('rpc')) {
    return 'AEGIS starts on QoreChain Diana Testnet for new users. Transfers are signed in the app; switch networks in Settings when you need Mainnet.';
  }
  return 'I am the Aegis AI wallet agent. I can explain your QoreChain accounts, prepare transfers and swaps, and help review dapp connection requests.';
}

export async function sendAgentMessage({ text, history, wallet, conversationId, language, selectedNetwork, swapEnabled }) {
  const clean = text.trim();
  if (!clean) throw new Error('Message is required.');

  if (!API_BASE_URL) {
    return {
      content: localAgentReply(clean, wallet),
      creditsRemaining: null,
      source: 'local',
    };
  }

  const authHeaders = await getAuthHeaders(wallet.mnemonic);
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      message: clean,
      history,
      conversationId,
      language,
      selectedNetwork,
      swapEnabled,
      qoreAddress: wallet.accounts.native.address,
      svmAddress: wallet.accounts.svm.address,
    }),
  });

  if (response.status === 429) {
    return {
      content:
        "You've used all of today's free messages. Your credits reset at midnight UTC — everything else in the wallet keeps working as usual. See you tomorrow!",
      blocked: true,
      creditsRemaining: 0,
      source: 'server',
    };
  }

  if (!response.ok) {
    throw new Error('Agent service is unavailable.');
  }

  const decoded = await response.json();
  return {
    content: decoded.response || 'Agent returned an empty response.',
    proposal: decoded.proposal || null,
    creditsRemaining: decoded.creditsRemaining ?? null,
    conversationId: decoded.conversationId || conversationId || null,
    source: 'server',
  };
}