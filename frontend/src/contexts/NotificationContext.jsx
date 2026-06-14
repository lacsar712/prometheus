import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
    notificationApi,
    buildNotificationWsUrl,
    TOKEN_KEY,
} from '../utils/api';
import { toast } from 'react-toastify';

const NotificationContext = createContext(null);

export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
};

const BEEP_SETTING_KEY = 'notification_beep_enabled';

const playBeeBuzz = () => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const audioCtx = new AudioContext();
        const now = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.linearRampToValueAtTime(440, now + 0.08);
        osc.frequency.linearRampToValueAtTime(520, now + 0.16);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.14);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.22);

        osc.onended = () => {
            audioCtx.close();
        };
    } catch (e) {
        console.warn('Failed to play beep:', e);
    }
};

const getBeepEnabled = () => {
    try {
        const v = localStorage.getItem(BEEP_SETTING_KEY);
        return v === null ? true : v === 'true';
    } catch {
        return true;
    }
};

const setBeepEnabled = (enabled) => {
    try {
        localStorage.setItem(BEEP_SETTING_KEY, String(enabled));
    } catch {
        /* ignore */
    }
};

const SEVERITY_TOAST_STYLES = {
    critical: {
        className: '!bg-red-500/20 !border !border-red-500/50 !text-red-200',
    },
    warning: {
        className: '!bg-amber-500/20 !border !border-amber-500/50 !text-amber-200',
    },
    info: {
        className: '!bg-blue-500/20 !border !border-blue-500/50 !text-blue-200',
    },
};

export const NotificationProvider = ({ children }) => {
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadByCategory, setUnreadByCategory] = useState({ alert: 0, system: 0, business: 0 });
    const [messages, setMessages] = useState([]);
    const [messagesTotal, setMessagesTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState(null);
    const [beepEnabled, setBeepEnabledState] = useState(getBeepEnabled());

    const wsRef = useRef(null);
    const heartbeatRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptsRef = useRef(0);

    const fetchUnreadCount = useCallback(async () => {
        try {
            const res = await notificationApi.getUnreadCount();
            setUnreadCount(res.data.total);
            setUnreadByCategory(res.data.by_category || {});
        } catch (err) {
            console.warn('Failed to fetch unread count:', err);
        }
    }, []);

    const fetchMessages = useCallback(
        async (category = activeCategory, page = 1, size = 50) => {
            setLoading(true);
            try {
                const params = { page, size };
                if (category) params.category = category;
                const res = await notificationApi.list(params);
                setMessages(res.data.items || []);
                setMessagesTotal(res.data.total || 0);
                if (res.data.unread_count !== undefined) {
                    setUnreadCount(res.data.unread_count);
                }
            } catch (err) {
                console.warn('Failed to fetch messages:', err);
            } finally {
                setLoading(false);
            }
        },
        [activeCategory]
    );

    const markAsRead = useCallback(
        async (id) => {
            try {
                await notificationApi.markRead(id);
                setMessages((prev) =>
                    prev.map((m) => (m.id === id ? { ...m, is_read: true, read_at: new Date().toISOString() } : m))
                );
                setUnreadCount((prev) => Math.max(0, prev - 1));
                setUnreadByCategory((prev) => {
                    const msg = messages.find((m) => m.id === id);
                    if (!msg) return prev;
                    return { ...prev, [msg.category]: Math.max(0, (prev[msg.category] || 0) - 1) };
                });
            } catch (err) {
                console.warn('Failed to mark as read:', err);
            }
        },
        [messages]
    );

    const markAllAsRead = useCallback(
        async (category = null) => {
            try {
                await notificationApi.markAllRead(category || undefined);
                setMessages((prev) =>
                    prev.map((m) =>
                        !category || m.category === category
                            ? { ...m, is_read: true, read_at: new Date().toISOString() }
                            : m
                    )
                );
                if (category) {
                    setUnreadByCategory((prev) => ({ ...prev, [category]: 0 }));
                    const remainingUnread = Object.entries(unreadByCategory).reduce(
                        (sum, [k, v]) => sum + (k === category ? 0 : v),
                        0
                    );
                    setUnreadCount(remainingUnread);
                } else {
                    setUnreadCount(0);
                    setUnreadByCategory({ alert: 0, system: 0, business: 0 });
                }
            } catch (err) {
                console.warn('Failed to mark all as read:', err);
            }
        },
        [unreadByCategory]
    );

    const removeMessage = useCallback(
        async (id) => {
            try {
                await notificationApi.remove(id);
                const msg = messages.find((m) => m.id === id);
                setMessages((prev) => prev.filter((m) => m.id !== id));
                setMessagesTotal((prev) => Math.max(0, prev - 1));
                if (msg && !msg.is_read) {
                    setUnreadCount((prev) => Math.max(0, prev - 1));
                    setUnreadByCategory((prev) => ({
                        ...prev,
                        [msg.category]: Math.max(0, (prev[msg.category] || 0) - 1),
                    }));
                }
            } catch (err) {
                console.warn('Failed to delete message:', err);
            }
        },
        [messages]
    );

    const toggleBeep = useCallback(() => {
        setBeepEnabledState((prev) => {
            const next = !prev;
            setBeepEnabled(next);
            return next;
        });
    }, []);

    const openDrawer = useCallback((category = null) => {
        setActiveCategory(category);
        setDrawerOpen(true);
    }, []);

    const closeDrawer = useCallback(() => {
        setDrawerOpen(false);
    }, []);

    const handleNewNotification = useCallback(
        (notification) => {
            setMessages((prev) => [notification, ...prev]);
            setMessagesTotal((prev) => prev + 1);
            setUnreadCount((prev) => prev + 1);
            setUnreadByCategory((prev) => ({
                ...prev,
                [notification.category]: (prev[notification.category] || 0) + 1,
            }));

            const style = SEVERITY_TOAST_STYLES[notification.severity] || SEVERITY_TOAST_STYLES.info;
            toast(
                <div className="pr-2">
                    <div className="font-semibold text-sm mb-1">{notification.title}</div>
                    <div className="text-xs opacity-80 line-clamp-2">{notification.content}</div>
                </div>,
                {
                    position: 'bottom-right',
                    autoClose: 6000,
                    closeOnClick: true,
                    pauseOnHover: true,
                    ...style,
                    onClick: () => {
                        openDrawer(notification.category);
                        if (!notification.is_read) {
                            markAsRead(notification.id);
                        }
                    },
                }
            );

            if (beepEnabled) {
                playBeeBuzz();
            }
        },
        [beepEnabled, openDrawer, markAsRead]
    );

    const connectWebSocket = useCallback(() => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return;

        if (wsRef.current) {
            try {
                wsRef.current.close();
            } catch {
                /* ignore */
            }
            wsRef.current = null;
        }

        try {
            const url = buildNotificationWsUrl(token);
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectAttemptsRef.current = 0;
                heartbeatRef.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({ type: 'ping' }));
                        } catch {
                            /* ignore */
                        }
                    }
                }, 30000);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'new_notification' && msg.data) {
                        handleNewNotification(msg.data);
                    }
                } catch (err) {
                    console.warn('Failed to parse WS message:', err);
                }
            };

            ws.onerror = (err) => {
                console.warn('WebSocket error:', err);
            };

            ws.onclose = () => {
                if (heartbeatRef.current) {
                    clearInterval(heartbeatRef.current);
                    heartbeatRef.current = null;
                }
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                }
                reconnectAttemptsRef.current += 1;
                const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
                reconnectTimerRef.current = setTimeout(() => {
                    connectWebSocket();
                }, delay);
            };
        } catch (err) {
            console.warn('Failed to create WebSocket:', err);
        }
    }, [handleNewNotification]);

    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 60000);
        return () => clearInterval(interval);
    }, [fetchUnreadCount]);

    useEffect(() => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
            connectWebSocket();
        }
        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch {
                    /* ignore */
                }
                wsRef.current = null;
            }
        };
    }, [connectWebSocket]);

    const value = {
        unreadCount,
        unreadByCategory,
        messages,
        messagesTotal,
        loading,
        drawerOpen,
        activeCategory,
        beepEnabled,
        fetchUnreadCount,
        fetchMessages,
        markAsRead,
        markAllAsRead,
        removeMessage,
        toggleBeep,
        openDrawer,
        closeDrawer,
        setActiveCategory,
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

export default NotificationContext;
