import { useState, useEffect, useCallback } from 'react';
import { apiKeyApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    Key,
    Plus,
    Copy,
    Check,
    Trash2,
    History,
    X,
    Clock,
    Shield,
    Cpu,
    Loader2,
    RefreshCw,
    AlertTriangle,
    Eye,
    EyeOff,
    ChevronDown,
    ChevronUp,
    Globe,
} from 'lucide-react';
import { toast } from 'react-toastify';

const EXPIRY_OPTIONS = [
    { label: '7 天', value: 7 },
    { label: '30 天', value: 30 },
    { label: '90 天', value: 90 },
    { label: '180 天', value: 180 },
    { label: '365 天', value: 365 },
    { label: '永不过期', value: null },
];

function ApiKeys() {
    const { user, hasPermission } = useAuth();
    const canRead = hasPermission('read');
    const canCreate = hasPermission('create');
    const canDelete = hasPermission('delete');

    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(false);
    const [scopes, setScopes] = useState([]);
    const [includeRevoked, setIncludeRevoked] = useState(false);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newKeyForm, setNewKeyForm] = useState({
        name: '',
        scopes: [],
        expires_days: 30,
        bound_device_id: '',
    });

    const [createdKey, setCreatedKey] = useState(null);
    const [keyCopied, setKeyCopied] = useState(false);

    const [showResultModal, setShowResultModal] = useState(false);
    const [revealKey, setRevealKey] = useState(false);

    const [expandedCallLog, setExpandedCallLog] = useState(null);
    const [callLogs, setCallLogs] = useState({});
    const [callLogsLoading, setCallLogsLoading] = useState({});

    const fetchKeys = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        try {
            const res = await apiKeyApi.list(includeRevoked);
            setKeys(res.data?.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取凭证列表失败');
        } finally {
            setLoading(false);
        }
    }, [canRead, includeRevoked]);

    const fetchScopes = useCallback(async () => {
        if (!canRead) return;
        try {
            const res = await apiKeyApi.getScopes();
            setScopes(res.data?.scopes || []);
        } catch (_) {
        }
    }, [canRead]);

    useEffect(() => {
        fetchKeys();
        fetchScopes();
    }, [fetchKeys, fetchScopes]);

    const openCreateModal = () => {
        setNewKeyForm({
            name: '',
            scopes: [],
            expires_days: 30,
            bound_device_id: '',
        });
        setShowCreateModal(true);
    };

    const toggleScope = (scopeValue) => {
        setNewKeyForm((prev) => {
            const current = prev.scopes;
            if (scopeValue === 'all') {
                return {
                    ...prev,
                    scopes: current.includes('all') ? [] : ['all'],
                };
            }
            const filtered = current.filter((s) => s !== 'all');
            if (filtered.includes(scopeValue)) {
                return { ...prev, scopes: filtered.filter((s) => s !== scopeValue) };
            }
            return { ...prev, scopes: [...filtered, scopeValue] };
        });
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!newKeyForm.name.trim()) {
            toast.warning('请输入凭证名称');
            return;
        }
        if (newKeyForm.scopes.length === 0) {
            toast.warning('请至少选择一个业务范围');
            return;
        }
        setCreating(true);
        try {
            const payload = { ...newKeyForm };
            if (!payload.bound_device_id?.trim()) delete payload.bound_device_id;
            if (payload.expires_days === null) delete payload.expires_days;
            const res = await apiKeyApi.create(payload);
            setCreatedKey(res.data);
            setShowCreateModal(false);
            setShowResultModal(true);
            setRevealKey(true);
            fetchKeys();
            toast.success('凭证签发成功！请妥善保存，完整凭证仅展示一次');
        } catch (err) {
            const detail = err.response?.data?.detail;
            if (Array.isArray(detail)) {
                detail.forEach((d) => toast.error(d.msg || '创建失败'));
            } else {
                toast.error(detail || '创建失败');
            }
        } finally {
            setCreating(false);
        }
    };

    const handleRevoke = async (key) => {
        if (!window.confirm(`确定立即吊销凭证"${key.name}"？此操作不可撤销。`)) return;
        try {
            await apiKeyApi.revoke(key.id);
            toast.success('凭证已吊销');
            fetchKeys();
        } catch (err) {
            toast.error(err.response?.data?.detail || '吊销失败');
        }
    };

    const copyFullKey = async () => {
        if (!createdKey?.full_key) return;
        try {
            await navigator.clipboard.writeText(createdKey.full_key);
            setKeyCopied(true);
            toast.success('已复制到剪贴板');
            setTimeout(() => setKeyCopied(false), 2000);
        } catch (_) {
            toast.error('复制失败，请手动复制');
        }
    };

    const toggleCallLogs = async (key) => {
        if (expandedCallLog === key.id) {
            setExpandedCallLog(null);
            return;
        }
        setExpandedCallLog(key.id);
        if (!callLogs[key.id]) {
            setCallLogsLoading((prev) => ({ ...prev, [key.id]: true }));
            try {
                const res = await apiKeyApi.getCallLogs(key.id, 1, 50);
                setCallLogs((prev) => ({ ...prev, [key.id]: res.data?.items || [] }));
            } catch (err) {
                toast.error('获取调用历史失败');
            } finally {
                setCallLogsLoading((prev) => ({ ...prev, [key.id]: false }));
            }
        }
    };

    const isExpired = (key) => {
        if (!key.expires_at) return false;
        return new Date(key.expires_at) < new Date();
    };

    const formatDate = (d) => {
        if (!d) return '-';
        return new Date(d).toLocaleString('zh-CN');
    };

    const getStatusBadge = (key) => {
        if (key.is_revoked) {
            return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-500/15 text-slate-400">
                    <Trash2 className="w-3 h-3" /> 已吊销
                </span>
            );
        }
        if (isExpired(key)) {
            return (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-400">
                    <Clock className="w-3 h-3" /> 已过期
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-400">
                <Shield className="w-3 h-3" /> 有效
            </span>
        );
    };

    const getMethodColor = (method) => {
        const colors = {
            GET: 'text-emerald-400 bg-emerald-500/10',
            POST: 'text-blue-400 bg-blue-500/10',
            PUT: 'text-amber-400 bg-amber-500/10',
            DELETE: 'text-red-400 bg-red-500/10',
            PATCH: 'text-violet-400 bg-violet-500/10',
        };
        return colors[method] || 'text-slate-400 bg-slate-500/10';
    };

    const getStatusCodeColor = (code) => {
        if (code >= 200 && code < 300) return 'text-emerald-400';
        if (code >= 300 && code < 400) return 'text-blue-400';
        if (code >= 400 && code < 500) return 'text-amber-400';
        return 'text-red-400';
    };

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-6xl mx-auto space-y-8">
                <Header />

                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/20">
                            <Key className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">API Keys</h1>
                            <p className="text-sm text-slate-400">设备接入凭证管理 · 传感器与外部 SaaS 独立凭证</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-sm cursor-pointer hover:border-slate-600 transition-colors">
                            <input
                                type="checkbox"
                                checked={includeRevoked}
                                onChange={(e) => setIncludeRevoked(e.target.checked)}
                                className="rounded accent-indigo-500"
                            />
                            <span className="text-slate-300">包含已吊销</span>
                        </label>
                        {canCreate && (
                            <button
                                onClick={openCreateModal}
                                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium flex items-center gap-2 transition-colors shadow-lg shadow-indigo-500/20"
                            >
                                <Plus className="w-4 h-4" />
                                签发凭证
                            </button>
                        )}
                        <button
                            onClick={fetchKeys}
                            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                            title="刷新"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                            <Key className="w-5 h-5 text-indigo-400" />
                            <h2 className="text-xl font-semibold text-white">凭证列表</h2>
                        </div>
                        <span className="text-sm text-slate-400">
                            共 <span className="text-white font-medium">{keys.length}</span> 张凭证
                        </span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                        </div>
                    ) : keys.length > 0 ? (
                        <div className="space-y-3">
                            {keys.map((key) => (
                                <div
                                    key={key.id}
                                    className={`rounded-2xl border transition-all ${
                                        key.is_revoked || isExpired(key)
                                            ? 'bg-slate-800/20 border-slate-800 opacity-70'
                                            : 'bg-slate-800/40 border-slate-700 hover:border-indigo-500/30'
                                    }`}
                                >
                                    <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
                                        <div className="flex-1 min-w-0 space-y-3">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <h3 className="font-semibold text-white text-lg">{key.name}</h3>
                                                {getStatusBadge(key)}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <code className="font-mono text-sm bg-slate-900/60 px-3 py-1.5 rounded-lg text-indigo-300 border border-slate-700">
                                                    {key.key_prefix}
                                                    <span className="text-slate-600">••••••••••••</span>
                                                </code>
                                                <span className="text-xs text-slate-500">
                                                    签发人：<span className="text-slate-400">{key.issuer_username}</span>
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-1.5">
                                                {key.scope_names?.map((name, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="px-2 py-0.5 rounded-md text-xs bg-slate-700/40 text-slate-300 border border-slate-700/50"
                                                    >
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
                                                <div className="flex items-center gap-1.5 text-slate-500">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    <span>过期：</span>
                                                    <span className={isExpired(key) ? 'text-red-400' : 'text-slate-300'}>
                                                        {key.expires_at ? formatDate(key.expires_at) : '永不过期'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-slate-500">
                                                    <History className="w-3.5 h-3.5" />
                                                    <span>最近调用：</span>
                                                    <span className="text-slate-300">{formatDate(key.last_used_at)}</span>
                                                </div>
                                                {key.bound_device_id && (
                                                    <div className="flex items-center gap-1.5 text-slate-500">
                                                        <Cpu className="w-3.5 h-3.5" />
                                                        <span>绑定设备：</span>
                                                        <span className="text-amber-300 font-mono truncate">
                                                            {key.bound_device_id}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                onClick={() => toggleCallLogs(key)}
                                                className="p-2.5 rounded-xl bg-slate-700/40 text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-xs"
                                                title="查看调用历史"
                                            >
                                                <History className="w-4 h-4" />
                                                {expandedCallLog === key.id ? (
                                                    <ChevronUp className="w-4 h-4" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4" />
                                                )}
                                            </button>
                                            {canDelete && !key.is_revoked && !isExpired(key) && (
                                                <button
                                                    onClick={() => handleRevoke(key)}
                                                    className="p-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                                    title="立即吊销"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {expandedCallLog === key.id && (
                                        <div className="border-t border-slate-700/50 px-5 py-4 bg-slate-900/30 rounded-b-2xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <History className="w-4 h-4 text-indigo-400" />
                                                <h4 className="font-medium text-white text-sm">最近调用历史</h4>
                                                <span className="text-xs text-slate-500">（最多显示最近 50 条）</span>
                                            </div>

                                            {callLogsLoading[key.id] ? (
                                                <div className="flex items-center justify-center py-8">
                                                    <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                                                </div>
                                            ) : callLogs[key.id]?.length > 0 ? (
                                                <div className="overflow-x-auto rounded-xl border border-slate-700/50 bg-slate-900/50">
                                                    <table className="w-full text-left text-sm">
                                                        <thead>
                                                            <tr className="bg-slate-800/50 text-slate-400 text-xs">
                                                                <th className="px-4 py-3 font-medium">时间</th>
                                                                <th className="px-4 py-3 font-medium">方法</th>
                                                                <th className="px-4 py-3 font-medium">路径</th>
                                                                <th className="px-4 py-3 font-medium">状态码</th>
                                                                <th className="px-4 py-3 font-medium">来源 IP</th>
                                                                <th className="px-4 py-3 font-medium">设备 ID</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-800">
                                                            {callLogs[key.id].map((log) => (
                                                                <tr key={log.id} className="hover:bg-slate-800/20 transition-colors">
                                                                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                                                                        {formatDate(log.created_at)}
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${getMethodColor(log.method)}`}>
                                                                            {log.method}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3">
                                                                        <code className="text-xs font-mono text-slate-300 break-all">
                                                                            {log.path}
                                                                        </code>
                                                                    </td>
                                                                    <td className={`px-4 py-3 font-mono text-xs font-medium ${getStatusCodeColor(log.status_code)}`}>
                                                                        {log.status_code}
                                                                    </td>
                                                                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap font-mono">
                                                                        {log.source_ip || '-'}
                                                                    </td>
                                                                    <td className="px-4 py-3 text-xs text-amber-300 whitespace-nowrap font-mono">
                                                                        {log.device_id || '-'}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                                    <History className="w-10 h-10 text-slate-700 mb-2" />
                                                    <p className="text-slate-400 text-sm">暂无调用记录</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Key className="w-14 h-14 text-slate-700 mb-3" />
                            <p className="text-slate-400 mb-1">暂无接入凭证</p>
                            <p className="text-xs text-slate-600 mb-4">
                                签发凭证为传感器或外部 SaaS 提供独立访问权限
                            </p>
                            {canCreate && (
                                <button
                                    onClick={openCreateModal}
                                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center gap-2 transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    签发第一张凭证
                                </button>
                            )}
                        </div>
                    )}
                </section>

                <section className="glass-card rounded-3xl p-6 bg-gradient-to-br from-indigo-500/5 to-violet-500/5 border-indigo-500/20">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="text-sm space-y-2">
                            <h4 className="font-medium text-white">安全提示</h4>
                            <ul className="text-slate-400 space-y-1.5 list-disc list-inside">
                                <li>完整凭证仅在签发时展示 <span className="text-amber-300">一次</span>，请立即复制并妥善保存</li>
                                <li>通过请求头 <code className="text-indigo-300 bg-slate-800 px-1.5 py-0.5 rounded font-mono text-xs">X-API-Key</code> 携带凭证即可绕过用户登录</li>
                                <li>凭证访问受 <span className="text-emerald-300">业务范围</span> 与 <span className="text-amber-300">绑定设备</span> 双重限制</li>
                                <li>若凭证泄露，请立即吊销并重新签发</li>
                            </ul>
                        </div>
                    </div>
                </section>
            </div>

            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-indigo-500/20 rounded-xl">
                                    <Key className="w-5 h-5 text-indigo-400" />
                                </div>
                                <h3 className="text-xl font-semibold text-white">签发新凭证</h3>
                            </div>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    凭证名称 <span className="text-red-400">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={newKeyForm.name}
                                    onChange={(e) => setNewKeyForm({ ...newKeyForm, name: e.target.value })}
                                    placeholder="如：温度传感器集群、第三方SaaS对接"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-indigo-500 outline-none text-white placeholder-slate-600 transition-all"
                                    maxLength={200}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    业务范围 <span className="text-red-400">*</span>
                                </label>
                                <div className="space-y-2">
                                    {scopes.map((scope) => (
                                        <label
                                            key={scope.value}
                                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                                newKeyForm.scopes.includes(scope.value) ||
                                                (scope.value !== 'all' && newKeyForm.scopes.includes('all'))
                                                    ? 'bg-indigo-500/10 border-indigo-500/40'
                                                    : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={
                                                    newKeyForm.scopes.includes(scope.value) ||
                                                    (scope.value !== 'all' && newKeyForm.scopes.includes('all'))
                                                }
                                                disabled={scope.value !== 'all' && newKeyForm.scopes.includes('all')}
                                                onChange={() => toggleScope(scope.value)}
                                                className="mt-0.5 rounded accent-indigo-500"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-white text-sm flex items-center gap-2">
                                                    {scope.value === 'all' && (
                                                        <Shield className="w-3.5 h-3.5 text-violet-400" />
                                                    )}
                                                    {scope.name}
                                                </div>
                                                <code className="text-xs text-slate-500 font-mono mt-0.5 block">
                                                    {scope.value}
                                                </code>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    过期时间
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {EXPIRY_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.label}
                                            type="button"
                                            onClick={() => setNewKeyForm({ ...newKeyForm, expires_days: opt.value })}
                                            className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                                                newKeyForm.expires_days === opt.value
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                                    绑定设备 ID <span className="text-slate-500 text-xs">（可选）</span>
                                </label>
                                <div className="relative">
                                    <Cpu className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="text"
                                        value={newKeyForm.bound_device_id}
                                        onChange={(e) =>
                                            setNewKeyForm({ ...newKeyForm, bound_device_id: e.target.value })
                                        }
                                        placeholder="留空表示不限制设备"
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-indigo-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                        maxLength={200}
                                    />
                                </div>
                                <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                                    <Globe className="w-3 h-3" />
                                    绑定后凭证仅可用于该设备上报的数据请求
                                </p>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating}
                                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                                    签发凭证
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showResultModal && createdKey && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-amber-500/40 shadow-2xl shadow-amber-500/10">
                        <div className="flex items-center justify-between p-6 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <div className="p-2 bg-amber-500/20 rounded-xl">
                                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                                </div>
                                <h3 className="text-xl font-semibold text-white">凭证签发成功</h3>
                            </div>
                        </div>

                        <div className="p-6 space-y-5">
                            <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                <div className="text-sm space-y-1">
                                    <p className="font-medium text-amber-300">请立即复制并妥善保存！</p>
                                    <p className="text-amber-200/70">
                                        完整凭证仅在此时展示 <span className="font-bold">一次</span>，
                                        关闭窗口后将无法再次查看。
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-300">凭证名称</label>
                                <p className="text-white font-medium">{createdKey.name}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-slate-300 flex items-center justify-between">
                                    <span>完整凭证</span>
                                    <button
                                        onClick={() => setRevealKey(!revealKey)}
                                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                                    >
                                        {revealKey ? (
                                            <><EyeOff className="w-3.5 h-3.5" /> 隐藏</>
                                        ) : (
                                            <><Eye className="w-3.5 h-3.5" /> 显示</>
                                        )}
                                    </button>
                                </label>
                                <div className="relative">
                                    <input
                                        type={revealKey ? 'text' : 'password'}
                                        readOnly
                                        value={createdKey.full_key}
                                        className="w-full pr-24 pl-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-emerald-300 font-mono text-sm outline-none select-all"
                                    />
                                    <button
                                        onClick={copyFullKey}
                                        className={`absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                                            keyCopied
                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                        }`}
                                    >
                                        {keyCopied ? (
                                            <><Check className="w-3.5 h-3.5" /> 已复制</>
                                        ) : (
                                            <><Copy className="w-3.5 h-3.5" /> 复制</>
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="space-y-1">
                                    <span className="text-slate-500 block text-xs">业务范围</span>
                                    <div className="flex flex-wrap gap-1">
                                        {createdKey.scope_names?.map((n, i) => (
                                            <span key={i} className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300">
                                                {n}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-slate-500 block text-xs">过期时间</span>
                                    <p className="text-slate-300">
                                        {createdKey.expires_at ? formatDate(createdKey.expires_at) : '永不过期'}
                                    </p>
                                </div>
                                {createdKey.bound_device_id && (
                                    <div className="col-span-2 space-y-1">
                                        <span className="text-slate-500 block text-xs">绑定设备</span>
                                        <p className="text-amber-300 font-mono">{createdKey.bound_device_id}</p>
                                    </div>
                                )}
                            </div>

                            <div className="pt-2">
                                <button
                                    onClick={() => {
                                        setShowResultModal(false);
                                        setCreatedKey(null);
                                        setRevealKey(false);
                                    }}
                                    className="w-full px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                                >
                                    我已保存，关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ApiKeys;
