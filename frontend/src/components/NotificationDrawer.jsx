import { useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import {
    X,
    Check,
    Trash2,
    AlertTriangle,
    AlertOctagon,
    Info,
    Volume2,
    VolumeX,
    CheckCheck,
} from 'lucide-react';

const CATEGORY_TABS = [
    { key: null, label: '全部' },
    { key: 'alert', label: '蜂群告警', icon: AlertOctagon },
    { key: 'system', label: '系统通知', icon: Info },
    { key: 'business', label: '业务消息', icon: AlertTriangle },
];

const SEVERITY_STYLES = {
    critical: {
        label: '严重',
        badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30',
        icon: AlertOctagon,
        iconClass: 'text-red-400',
    },
    warning: {
        label: '警告',
        badgeClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
        icon: AlertTriangle,
        iconClass: 'text-amber-400',
    },
    info: {
        label: '提示',
        badgeClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
        icon: Info,
        iconClass: 'text-blue-400',
    },
};

const CATEGORY_BADGE_STYLES = {
    alert: 'bg-red-500/15 text-red-400 border border-red-500/20',
    system: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    business: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
};

const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    if (diffDay < 7) return `${diffDay}天前`;
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const NotificationDrawer = () => {
    const {
        drawerOpen,
        activeCategory,
        unreadCount,
        unreadByCategory,
        messages,
        loading,
        beepEnabled,
        fetchMessages,
        markAsRead,
        markAllAsRead,
        removeMessage,
        toggleBeep,
        openDrawer,
        closeDrawer,
        setActiveCategory,
    } = useNotification();

    useEffect(() => {
        if (drawerOpen) {
            fetchMessages(activeCategory);
        }
    }, [drawerOpen, activeCategory, fetchMessages]);

    const handleTabClick = (key) => {
        setActiveCategory(key);
    };

    if (!drawerOpen) return null;

    const filteredMessages = activeCategory
        ? messages.filter((m) => m.category === activeCategory)
        : messages;

    const unreadInCurrent = activeCategory
        ? unreadByCategory[activeCategory] || 0
        : unreadCount;

    return (
        <>
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                onClick={closeDrawer}
            />

            <div className="fixed right-0 top-0 h-full w-full sm:w-[440px] bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-white">消息中心</h2>
                        {unreadCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-medium border border-red-500/30">
                                {unreadCount} 条未读
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={toggleBeep}
                            className={`p-2 rounded-lg transition-colors ${
                                beepEnabled
                                    ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                                    : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                            }`}
                            title={beepEnabled ? '关闭提示音' : '开启提示音'}
                        >
                            {beepEnabled ? (
                                <Volume2 className="w-4 h-4" />
                            ) : (
                                <VolumeX className="w-4 h-4" />
                            )}
                        </button>
                        <button
                            onClick={closeDrawer}
                            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                        {CATEGORY_TABS.map((tab) => {
                            const isActive = activeCategory === tab.key;
                            const count = tab.key ? unreadByCategory[tab.key] || 0 : unreadCount;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.key ?? 'all'}
                                    onClick={() => handleTabClick(tab.key)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all ${
                                        isActive
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                                    }`}
                                >
                                    {Icon && <Icon className="w-3.5 h-3.5" />}
                                    <span>{tab.label}</span>
                                    {count > 0 && (
                                        <span
                                            className={`ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center ${
                                                isActive
                                                    ? 'bg-blue-500 text-white'
                                                    : 'bg-slate-600 text-slate-200'
                                            }`}
                                        >
                                            {count > 99 ? '99+' : count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="px-5 py-2.5 border-b border-slate-700/50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                        共 {filteredMessages.length} 条消息
                    </span>
                    <button
                        onClick={() => markAllAsRead(activeCategory)}
                        disabled={unreadInCurrent === 0}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>全部标为已读</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : filteredMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
                                <Info className="w-8 h-8 text-slate-600" />
                            </div>
                            <p className="text-slate-400 text-sm">暂无消息</p>
                            <p className="text-xs text-slate-600 mt-1">
                                {activeCategory ? '该分类下还没有消息' : '新消息将在这里显示'}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-800">
                            {filteredMessages.map((msg) => {
                                const sevStyle = SEVERITY_STYLES[msg.severity] || SEVERITY_STYLES.info;
                                const SevIcon = sevStyle.icon;
                                return (
                                    <div
                                        key={msg.id}
                                        className={`px-5 py-4 group hover:bg-slate-800/40 transition-colors cursor-pointer ${
                                            !msg.is_read ? 'bg-slate-800/20' : ''
                                        }`}
                                        onClick={() => {
                                            if (!msg.is_read) {
                                                markAsRead(msg.id);
                                            }
                                        }}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="shrink-0 mt-0.5">
                                                <SevIcon className={`w-4 h-4 ${sevStyle.iconClass}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <h3
                                                        className={`text-sm ${
                                                            !msg.is_read
                                                                ? 'font-semibold text-white'
                                                                : 'text-slate-300'
                                                        } leading-snug`}
                                                    >
                                                        {msg.title}
                                                    </h3>
                                                    <span className="text-[10px] text-slate-500 shrink-0 mt-0.5">
                                                        {formatTime(msg.created_at)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-2">
                                                    {msg.content}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_BADGE_STYLES[msg.category] || 'bg-slate-700 text-slate-300'}`}
                                                    >
                                                        {msg.category_name}
                                                    </span>
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5 ${sevStyle.badgeClass}`}
                                                    >
                                                        <SevIcon className="w-2.5 h-2.5" />
                                                        {sevStyle.label}
                                                    </span>
                                                    {!msg.is_read && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                {!msg.is_read && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            markAsRead(msg.id);
                                                        }}
                                                        className="p-1.5 rounded-lg text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors"
                                                        title="标为已读"
                                                    >
                                                        <Check className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeMessage(msg.id);
                                                    }}
                                                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                    title="删除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default NotificationDrawer;
