import { env } from '@pf/config';
import { prisma } from '@pf/db';
import { enqueueDrafting } from '@pf/queue';
import { checkQuota } from '@pf/quota';

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
};

type TelegramCallback = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
};

type TelegramResult<T> = { ok: true; result: T } | { ok: false; description?: string };

const ALERT_ACTIONS = [
  'connection_request',
  'connection_accept',
  'connection_reject',
  'connection_withdraw',
  'message_send',
  'profile_view',
  'post_create',
  'post_engage',
] as const;

function localDateParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: env.OWNER_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function startOfOwnerDay(now = new Date()): Date {
  const localNow = new Date(now.toLocaleString('en-US', { timeZone: env.OWNER_TIMEZONE }));
  const offset = localNow.getTime() - now.getTime();
  localNow.setHours(0, 0, 0, 0);
  return new Date(localNow.getTime() - offset);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** One plain message to the owner, for other parts of the worker. Never throws. */
export async function notifyOwner(text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_OWNER_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_OWNER_CHAT_ID, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error('Telegram notify failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

export function startTelegramBot(): () => void {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log('Telegram bot is disabled (TELEGRAM_BOT_TOKEN is empty)');
    return () => undefined;
  }

  const controller = new AbortController();
  const apiBase = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  let offset = 0;
  let pendingEdit: string | undefined;
  let lastSummaryDate = '';
  let lastAlertDate = '';
  const alertedIdentityStates = new Map<string, string>();
  const alertedQuotas = new Set<string>();

  async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${apiBase}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as TelegramResult<T>;
    if (!response.ok || !result.ok) {
      throw new Error(
        `Telegram ${method} failed: ${!result.ok ? result.description : response.statusText}`,
      );
    }
    return result.result;
  }

  async function send(chatId: string, text: string, replyMarkup?: unknown): Promise<void> {
    await call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      disable_web_page_preview: true,
    });
  }

  async function listPendingPosts(chatId: string): Promise<void> {
    const posts = await prisma.postDraft.findMany({
      where: { status: 'pending_approval' },
      orderBy: { createdAt: 'asc' },
      take: 10,
      include: { identity: { select: { label: true } } },
    });
    if (posts.length === 0) {
      await send(chatId, 'No posts are waiting for approval.');
      return;
    }
    for (const post of posts) {
      const text = post.text.length > 3000 ? `${post.text.slice(0, 2997)}...` : post.text;
      await send(
        chatId,
        `<b>${escapeHtml(post.identity.label)}</b> · ${escapeHtml(post.source)}\n\n${escapeHtml(text)}`,
        {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: `approve:${post.id}` },
              { text: 'Edit', callback_data: `edit:${post.id}` },
              { text: 'Skip', callback_data: `skip:${post.id}` },
            ],
          ],
        },
      );
    }
  }

  async function sendStats(chatId: string): Promise<void> {
    const identities = await prisma.identity.findMany({
      where: { status: { not: 'disabled' } },
      select: { id: true, label: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    if (identities.length === 0) {
      await send(chatId, 'No accounts are set up yet.');
      return;
    }
    const since = startOfOwnerDay();
    const lines = await Promise.all(
      identities.map(async (identity) => {
        const counts = await prisma.activity.groupBy({
          by: ['kind', 'succeeded'],
          where: { identityId: identity.id, occurredAt: { gte: since } },
          _count: { _all: true },
        });
        const totals = new Map<string, number>();
        for (const row of counts) {
          if (row.succeeded) totals.set(row.kind, (totals.get(row.kind) ?? 0) + row._count._all);
        }
        const accepted = totals.get('connection_accept') ?? 0;
        const requested = totals.get('connection_request') ?? 0;
        const status = identity.status === 'active' ? '' : ` · ⚠️ ${identity.status}`;
        return `<b>${escapeHtml(identity.label)}</b>${status}\nAccepted ${accepted} · Requests ${requested} · Posts ${totals.get('post_create') ?? 0}`;
      }),
    );
    await send(chatId, `<b>Today's growth</b>\n\n${lines.join('\n\n')}`);
  }

  async function requestDrafts(chatId: string, hint: string): Promise<void> {
    if (!env.ANTHROPIC_API_KEY) {
      await send(chatId, 'Drafting is off: ANTHROPIC_API_KEY is empty in the server .env.');
      return;
    }
    const profiles = await prisma.postingProfile.findMany({
      where: { identity: { status: { not: 'disabled' } } },
      select: { identityId: true, about: true, topics: true, identity: { select: { label: true } } },
    });
    const ready = profiles.filter((p) => p.about.trim() || p.topics.trim());
    if (ready.length === 0) {
      await send(chatId, 'No account has a posting profile yet. Fill one in from the account screen in the app.');
      return;
    }
    for (const p of ready) {
      await enqueueDrafting({ identityId: p.identityId, count: 3, hint: hint || undefined, requestedBy: 'owner' });
    }
    await send(
      chatId,
      `Claude is writing drafts for ${ready.map((p) => escapeHtml(p.identity.label)).join(', ')}. I’ll message you when they’re ready.`,
    );
  }

  async function sendDailySummary(): Promise<void> {
    if (!env.TELEGRAM_OWNER_CHAT_ID) return;
    const date = localDateParts(new Date());
    if (date.hour !== String(env.DAILY_SUMMARY_HOUR).padStart(2, '0') || Number(date.minute) > 5)
      return;
    const today = `${date.year}-${date.month}-${date.day}`;
    if (today === lastSummaryDate) return;
    lastSummaryDate = today;
    await send(env.TELEGRAM_OWNER_CHAT_ID, '<b>Daily summary</b>');
    await sendStats(env.TELEGRAM_OWNER_CHAT_ID);
    await listPendingPosts(env.TELEGRAM_OWNER_CHAT_ID);
  }

  async function sendUrgentAlerts(): Promise<void> {
    if (!env.TELEGRAM_OWNER_CHAT_ID) return;
    const date = localDateParts(new Date());
    const today = `${date.year}-${date.month}-${date.day}`;
    if (today !== lastAlertDate) {
      lastAlertDate = today;
      alertedQuotas.clear();
    }

    const identities = await prisma.identity.findMany({
      where: { status: { in: ['expired', 'challenged', 'restricted'] } },
      select: { id: true, label: true, status: true, statusReason: true },
    });
    for (const identity of identities) {
      const state = `${identity.status}:${identity.statusReason ?? ''}`;
      if (alertedIdentityStates.get(identity.id) === state) continue;
      alertedIdentityStates.set(identity.id, state);
      await send(
        env.TELEGRAM_OWNER_CHAT_ID,
        `⚠️ <b>${escapeHtml(identity.label)} needs attention</b>\n${escapeHtml(identity.statusReason ?? identity.status)}`,
      );
    }

    for (const identity of await prisma.identity.findMany({
      where: { status: { not: 'disabled' } },
      select: { id: true, label: true },
    })) {
      for (const action of ALERT_ACTIONS) {
        const quota = await checkQuota(identity.id, action);
        const key = `${identity.id}:${action}`;
        if (quota.remaining !== 0 || alertedQuotas.has(key)) continue;
        alertedQuotas.add(key);
        await send(
          env.TELEGRAM_OWNER_CHAT_ID,
          `⚠️ <b>${escapeHtml(identity.label)}</b> reached today's ${escapeHtml(action.replaceAll('_', ' '))} limit (${quota.limit}).`,
        );
      }
    }
  }

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim();
    if (!text) return;

    if (!env.TELEGRAM_OWNER_CHAT_ID) {
      if (text.startsWith('/start')) {
        await send(
          chatId,
          `Your chat ID is <code>${chatId}</code>. Add it as TELEGRAM_OWNER_CHAT_ID in the server's .env, then restart PhantomForge. The bot won't control anything until you do.`,
        );
      }
      return;
    }
    if (chatId !== env.TELEGRAM_OWNER_CHAT_ID) return;

    if (pendingEdit) {
      const postId = pendingEdit;
      pendingEdit = undefined;
      if (text.startsWith('/')) {
        await send(chatId, 'Edit cancelled. Use /posts to review pending drafts.');
        return;
      }
      if (text.length > 3000) {
        await send(
          chatId,
          'That draft is over 3,000 characters. Use /posts to try again with a shorter edit.',
        );
        return;
      }
      const updated = await prisma.postDraft.updateMany({
        where: { id: postId, status: 'pending_approval' },
        data: { text, status: 'approved', decidedAt: new Date() },
      });
      await send(
        chatId,
        updated.count
          ? 'Edited and approved. It will publish according to its schedule.'
          : 'That draft is no longer waiting for approval.',
      );
      return;
    }

    if (text.startsWith('/start') || text.startsWith('/help')) {
      await send(
        chatId,
        '<b>PhantomForge</b>\n/posts - review drafts\n/stats - today’s account activity\n/draft - Claude writes 3 new drafts per account\n/draft &lt;idea&gt; - drafts about that idea\n/edit &lt;post id&gt; - edit and approve a draft',
      );
    } else if (text.startsWith('/draft')) {
      await requestDrafts(chatId, text.slice('/draft'.length).trim());
    } else if (text.startsWith('/posts')) {
      await listPendingPosts(chatId);
    } else if (text.startsWith('/stats')) {
      await sendStats(chatId);
    } else if (text.startsWith('/edit ')) {
      const postId = text.slice(6).trim();
      const post = await prisma.postDraft.findFirst({
        where: { id: postId, status: 'pending_approval' },
      });
      if (!post)
        await send(
          chatId,
          'I couldn’t find a pending draft with that id. Use /posts to see available drafts.',
        );
      else {
        pendingEdit = post.id;
        await send(chatId, `Send the replacement text for this draft:\n\n${escapeHtml(post.text)}`);
      }
    } else {
      await send(chatId, 'I didn’t recognize that command. Use /help.');
    }
  }

  async function handleCallback(callback: TelegramCallback): Promise<void> {
    const chatId = callback.message ? String(callback.message.chat.id) : undefined;
    if (!chatId || chatId !== env.TELEGRAM_OWNER_CHAT_ID || !callback.data) {
      await call('answerCallbackQuery', { callback_query_id: callback.id, text: 'Not authorized' });
      return;
    }
    const [action, postId] = callback.data.split(':', 2);
    if (!postId || !['approve', 'edit', 'skip'].includes(action ?? '')) {
      await call('answerCallbackQuery', { callback_query_id: callback.id, text: 'Unknown action' });
      return;
    }
    if (action === 'edit') {
      pendingEdit = postId;
      await call('answerCallbackQuery', {
        callback_query_id: callback.id,
        text: 'Send the replacement text in this chat.',
      });
      await send(
        chatId,
        'Send the replacement text for this draft. It will be approved after you send it.',
      );
      return;
    }
    const updated = await prisma.postDraft.updateMany({
      where: {
        id: postId,
        status:
          action === 'approve' ? 'pending_approval' : { in: ['pending_approval', 'approved'] },
        ...(action === 'skip' ? { runId: null } : {}),
      },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        decidedAt: new Date(),
      },
    });
    const message = updated.count
      ? action === 'approve'
        ? 'Approved.'
        : 'Skipped.'
      : 'This draft is already publishing or has been decided.';
    await call('answerCallbackQuery', { callback_query_id: callback.id, text: message });
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  }

  async function poll(): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const updates = await call<TelegramUpdate[]>('getUpdates', {
          offset,
          timeout: 20,
          allowed_updates: ['message', 'callback_query'],
        });
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error(
              'Telegram update failed:',
              error instanceof Error ? error.message : 'unknown error',
            );
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(
          'Telegram polling failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  const pollTimer = setInterval(() => {
    void sendDailySummary().catch((error: unknown) =>
      console.error(
        'Telegram summary failed:',
        error instanceof Error ? error.message : 'unknown error',
      ),
    );
    void sendUrgentAlerts().catch((error: unknown) =>
      console.error(
        'Telegram alert check failed:',
        error instanceof Error ? error.message : 'unknown error',
      ),
    );
  }, 60_000);
  void poll();
  console.log('Telegram bot polling is enabled');

  return () => {
    clearInterval(pollTimer);
    controller.abort();
  };
}
