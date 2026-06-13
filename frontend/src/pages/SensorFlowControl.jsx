import { useState, useEffect, useCallback, useRef } from 'react';
import { rateLimitApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    ShieldAlert,
    Plus,
    Power,
    PowerOff,
    Edit3,
    Trash2,
    X,
    Check,
    Loader2,
    Ban,
    Unlock,
    Activity,
    BarChart3,
    Gauge,
    RefreshCw,
} from 'lucide-react';
import { toast } from 'react-toastify';

const defaultFormData = {
    name: '',
    path_pattern: '/api/sensor-data',
    device_id_pattern: '*',
    ip_range: '',
    rate_limit: 60,
    burst: 10,
    is_enabled: true,
};

function SensorFlowControl() {
    const { user, hasPermission } = useAuth();
    const canRead = hasPermission('read');
    const canCreate = hasPermission('create');
    const canUpdate = hasPermission('update');
    const canDelete = hasPermission('delete');

    const [rules, setRules] = useState([]);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(false);

    const [showModal, setShowModal] = useState(false);
    const [editingRule, setEditingRule] = useState(null);
    const [formData, setFormData] = useState({ ...defaultFormData });
    const [submitting, setSubmitting] = useState(false);

    const [banDeviceId, setBanDeviceId] = useState('');
    const [banReason, setBanReason] = useState('');
    const [banDuration, setBanDuration] = useState('');
    const [banning, setBanning] = useState(false);

    const [showBanModal, setShowBanModal] = useState(false);

    const chartCanvasRef = useRef(null);
    const refreshTimerRef = useRef(null);

    const fetchRules = useCallback(async () => {
        if (!canRead) return;
        setRulesLoading(true);
        try {
            const res = await rateLimitApi.listRules();
            setRules(res.data || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取限流规则失败');
        } finally {
            setRulesLoading(false);
        }
    }, [canRead]);

    const fetchStats = useCallback(async () => {
        if (!canRead) return;
        setStatsLoading(true);
        try {
            const res = await rateLimitApi.getStats();
            setStats(res.data);
        } catch (_) {
        } finally {
            setStatsLoading(false);
        }
    }, [canRead]);

    useEffect(() => {
        fetchRules();
        fetchStats();
    }, [fetchRules, fetchStats]);

    useEffect(() => {
        refreshTimerRef.current = setInterval(() => {
            fetchStats();
        }, 5000);
        return () => {
            if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
        };
    }, [fetchStats]);

    useEffect(() => {
        if (!stats?.hit_time_series || !chartCanvasRef.current) return;
        drawChart(stats.hit_time_series);
    }, [stats?.hit_time_series]);

    const drawChart = (timeSeries) => {
        const canvas = chartCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 30, right: 20, bottom: 40, left: 50 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        ctx.clearRect(0, 0, w, h);

        const maxVal = Math.max(...timeSeries.map((d) => d.hit_count), 1);
        const barWidth = chartW / timeSeries.length * 0.6;
        const gap = chartW / timeSeries.length * 0.4;

        ctx.strokeStyle = 'rgba(148,163,184,0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();
            ctx.fillStyle = 'rgba(148,163,184,0.5)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padding.left - 8, y + 4);
        }

        timeSeries.forEach((item, idx) => {
            const x = padding.left + (chartW / timeSeries.length) * idx + gap / 2;
            const barH = (item.hit_count / maxVal) * chartH;
            const y = padding.top + chartH - barH;

            const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartH);
            gradient.addColorStop(0, 'rgba(139,92,246,0.9)');
            gradient.addColorStop(1, 'rgba(139,92,246,0.2)');
            ctx.fillStyle = gradient;

            const radius = 4;
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + barWidth - radius, y);
            ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
            ctx.lineTo(x + barWidth, padding.top + chartH);
            ctx.lineTo(x, padding.top + chartH);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = 'rgba(148,163,184,0.7)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(item.timestamp, x + barWidth / 2, padding.top + chartH + 20);

            if (item.hit_count > 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillText(item.hit_count, x + barWidth / 2, y - 8);
            }
        });

        ctx.fillStyle = 'rgba(148,163,184,0.6)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('限流命中次数（最近5分钟，按分钟统计）', w / 2, h - 4);
    };

    const openCreateModal = () => {
        setEditingRule(null);
        setFormData({ ...defaultFormData });
        setShowModal(true);
    };

    const openEditModal = (rule) => {
        setEditingRule(rule);
        setFormData({
            name: rule.name,
            path_pattern: rule.path_pattern,
            device_id_pattern: rule.device_id_pattern,
            ip_range: rule.ip_range || '',
            rate_limit: rule.rate_limit,
            burst: rule.burst,
            is_enabled: rule.is_enabled,
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) {
            toast.warning('请输入规则名称');
            return;
        }
        setSubmitting(true);
        try {
            const payload = { ...formData };
            if (!payload.ip_range) delete payload.ip_range;
            if (editingRule) {
                await rateLimitApi.updateRule(editingRule.id, payload);
                toast.success('规则更新成功');
            } else {
                await rateLimitApi.createRule(payload);
                toast.success('规则创建成功');
            }
            setShowModal(false);
            fetchRules();
        } catch (err) {
            toast.error(err.response?.data?.detail || '保存失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggle = async (rule) => {
        try {
            await rateLimitApi.toggleRule(rule.id);
            toast.success(rule.is_enabled ? '已禁用' : '已启用');
            fetchRules();
        } catch (err) {
            toast.error('操作失败');
        }
    };

    const handleDelete = async (rule) => {
        if (!window.confirm(`确定删除规则"${rule.name}"？`)) return;
        try {
            await rateLimitApi.deleteRule(rule.id);
            toast.success('删除成功');
            fetchRules();
        } catch (err) {
            toast.error('删除失败');
        }
    };

    const handleBan = async () => {
        if (!banDeviceId.trim()) {
            toast.warning('请输入设备ID');
            return;
        }
        setBanning(true);
        try {
            await rateLimitApi.banDevice({
                device_id: banDeviceId.trim(),
                reason: banReason.trim() || undefined,
                duration_minutes: banDuration ? parseInt(banDuration) : undefined,
            });
            toast.success(`设备 ${banDeviceId} 已封禁`);
            setBanDeviceId('');
            setBanReason('');
            setBanDuration('');
            setShowBanModal(false);
            fetchStats();
        } catch (err) {
            toast.error(err.response?.data?.detail || '封禁失败');
        } finally {
            setBanning(false);
        }
    };

    const handleUnban = async (deviceId) => {
        try {
            await rateLimitApi.unbanDevice(deviceId);
            toast.success(`设备 ${deviceId} 已解封`);
            fetchStats();
        } catch (err) {
            toast.error(err.response?.data?.detail || '解封失败');
        }
    };

    const isSuspicious = (device) => device.hit_count_5min >= 5;

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-6xl mx-auto space-y-8">
                <Header />

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-rose-600 rounded-2xl shadow-lg shadow-rose-500/20">
                            <ShieldAlert className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">传感器流控</h1>
                            <p className="text-sm text-slate-400">令牌桶限流监控与设备流控管理</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {canCreate && (
                            <button
                                onClick={openCreateModal}
                                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center gap-2 transition-colors shadow-lg shadow-rose-500/20"
                            >
                                <Plus className="w-4 h-4" />
                                新建规则
                            </button>
                        )}
                        {canUpdate && (
                            <button
                                onClick={() => setShowBanModal(true)}
                                className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium flex items-center gap-2 transition-colors"
                            >
                                <Ban className="w-4 h-4" />
                                封禁设备
                            </button>
                        )}
                        <button
                            onClick={() => { fetchRules(); fetchStats(); }}
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
                            <ShieldAlert className="w-5 h-5 text-rose-400" />
                            <h2 className="text-xl font-semibold text-white">限流规则配置</h2>
                        </div>
                        <span className="text-sm text-slate-400">
                            共 <span className="text-white font-medium">{rules.length}</span> 条规则
                        </span>
                    </div>

                    {rulesLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
                        </div>
                    ) : rules.length > 0 ? (
                        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-800/50 text-slate-400 text-sm">
                                        <th className="px-5 py-4 font-medium">规则名称</th>
                                        <th className="px-5 py-4 font-medium">业务路径</th>
                                        <th className="px-5 py-4 font-medium">设备匹配</th>
                                        <th className="px-5 py-4 font-medium">IP段</th>
                                        <th className="px-5 py-4 font-medium">令牌/分钟</th>
                                        <th className="px-5 py-4 font-medium">突发容量</th>
                                        <th className="px-5 py-4 font-medium">状态</th>
                                        <th className="px-5 py-4 font-medium text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {rules.map((rule) => (
                                        <tr key={rule.id} className="hover:bg-slate-800/30 transition-colors">
                                            <td className="px-5 py-4">
                                                <div className="font-medium text-white">{rule.name}</div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <code className="text-xs bg-slate-800 px-2 py-1 rounded text-violet-300 font-mono">
                                                    {rule.path_pattern}
                                                </code>
                                            </td>
                                            <td className="px-5 py-4">
                                                <code className="text-xs bg-slate-800 px-2 py-1 rounded text-emerald-300 font-mono">
                                                    {rule.device_id_pattern}
                                                </code>
                                            </td>
                                            <td className="px-5 py-4">
                                                {rule.ip_range ? (
                                                    <code className="text-xs bg-slate-800 px-2 py-1 rounded text-amber-300 font-mono">
                                                        {rule.ip_range}
                                                    </code>
                                                ) : (
                                                    <span className="text-xs text-slate-600">全部</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className="text-sm text-white font-medium">{rule.rate_limit}</span>
                                                <span className="text-xs text-slate-500 ml-1">次/分</span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className="text-sm text-white">{rule.burst}</span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                                                    rule.is_enabled
                                                        ? 'bg-emerald-500/15 text-emerald-400'
                                                        : 'bg-slate-500/15 text-slate-400'
                                                }`}>
                                                    {rule.is_enabled ? (
                                                        <><Power className="w-3 h-3" /> 已启用</>
                                                    ) : (
                                                        <><PowerOff className="w-3 h-3" /> 已禁用</>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end gap-1.5">
                                                    {canUpdate && (
                                                        <>
                                                            <button
                                                                onClick={() => handleToggle(rule)}
                                                                title={rule.is_enabled ? '禁用' : '启用'}
                                                                className={`p-2 rounded-lg transition-colors ${
                                                                    rule.is_enabled
                                                                        ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                                                        : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                                                }`}
                                                            >
                                                                {rule.is_enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                                                            </button>
                                                            <button
                                                                onClick={() => openEditModal(rule)}
                                                                title="编辑"
                                                                className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                                            >
                                                                <Edit3 className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                    {canDelete && (
                                                        <button
                                                            onClick={() => handleDelete(rule)}
                                                            title="删除"
                                                            className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <ShieldAlert className="w-12 h-12 text-slate-700 mb-3" />
                            <p className="text-slate-400">暂无限流规则</p>
                            <p className="text-xs text-slate-600 mt-1">默认每设备每分钟 60 次，点击"新建规则"自定义配置</p>
                        </div>
                    )}
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <section className="glass-card rounded-3xl p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <BarChart3 className="w-5 h-5 text-violet-400" />
                            <h2 className="text-xl font-semibold text-white">限流命中统计</h2>
                            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
                                实时
                            </span>
                        </div>
                        <div className="relative" style={{ height: '220px' }}>
                            {statsLoading && !stats ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
                                </div>
                            ) : (
                                <canvas
                                    ref={chartCanvasRef}
                                    style={{ width: '100%', height: '100%' }}
                                />
                            )}
                        </div>
                    </section>

                    <section className="glass-card rounded-3xl p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <Gauge className="w-5 h-5 text-amber-400" />
                            <h2 className="text-xl font-semibold text-white">Top10 被限流设备</h2>
                            <span className="text-xs text-slate-500">（近5分钟）</span>
                        </div>
                        {stats?.top10_limited?.length > 0 ? (
                            <div className="space-y-2">
                                {stats.top10_limited.map((item, idx) => {
                                    const maxHit = stats.top10_limited[0]?.hit_count || 1;
                                    const pct = Math.max(5, (item.hit_count / maxHit) * 100);
                                    const suspicious = item.hit_count >= 5;
                                    return (
                                        <div
                                            key={item.device_id}
                                            className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                                                suspicious
                                                    ? 'bg-red-500/10 border border-red-500/30'
                                                    : 'bg-slate-800/40'
                                            }`}
                                        >
                                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                                idx < 3
                                                    ? 'bg-amber-500/20 text-amber-400'
                                                    : 'bg-slate-700 text-slate-400'
                                            }`}>
                                                {idx + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-sm font-medium truncate ${suspicious ? 'text-red-300' : 'text-white'}`}>
                                                        {item.device_id}
                                                    </span>
                                                    {suspicious && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 uppercase tracking-wider">
                                                            高频
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            suspicious ? 'bg-red-500' : 'bg-violet-500'
                                                        }`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <span className={`text-sm font-mono shrink-0 ${suspicious ? 'text-red-400' : 'text-slate-300'}`}>
                                                {item.hit_count}次
                                            </span>
                                            {canUpdate && (
                                                <button
                                                    onClick={() => {
                                                        setBanDeviceId(item.device_id);
                                                        setShowBanModal(true);
                                                    }}
                                                    title="封禁此设备"
                                                    className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors shrink-0"
                                                    disabled={stats?.banned_devices?.some(b => b.device_id === item.device_id)}
                                                >
                                                    <Ban className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                                <Gauge className="w-10 h-10 text-slate-700 mb-2" />
                                <p className="text-slate-400 text-sm">暂无限流命中记录</p>
                            </div>
                        )}
                    </section>
                </div>

                <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <Activity className="w-5 h-5 text-emerald-400" />
                        <h2 className="text-xl font-semibold text-white">设备令牌实时状态</h2>
                        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
                            每5秒刷新
                        </span>
                    </div>
                    {stats?.device_stats?.length > 0 ? (
                        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-800/50 text-slate-400 text-sm">
                                        <th className="px-5 py-3 font-medium">设备ID</th>
                                        <th className="px-5 py-3 font-medium">限流阈值</th>
                                        <th className="px-5 py-3 font-medium">剩余令牌</th>
                                        <th className="px-5 py-3 font-medium">令牌水位</th>
                                        <th className="px-5 py-3 font-medium">5分钟命中</th>
                                        <th className="px-5 py-3 font-medium text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {stats.device_stats
                                        .sort((a, b) => b.hit_count_5min - a.hit_count_5min)
                                        .map((device) => {
                                        const suspicious = isSuspicious(device);
                                        const tokenPct = Math.min(100, (device.remaining_tokens / device.rate_limit) * 100);
                                        const isBanned = stats?.banned_devices?.some(b => b.device_id === device.device_id);
                                        return (
                                            <tr
                                                key={device.device_id}
                                                className={`transition-colors ${
                                                    suspicious ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-slate-800/30'
                                                }`}
                                            >
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`font-medium ${suspicious ? 'text-red-300' : 'text-white'}`}>
                                                            {device.device_id}
                                                        </span>
                                                        {suspicious && (
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">
                                                                可疑
                                                            </span>
                                                        )}
                                                        {isBanned && (
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-500/20 text-slate-400">
                                                                已封禁
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className="text-sm text-slate-300">{device.rate_limit}/分</span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className={`text-sm font-mono ${
                                                        tokenPct < 20 ? 'text-red-400' : tokenPct < 50 ? 'text-amber-400' : 'text-emerald-400'
                                                    }`}>
                                                        {device.remaining_tokens}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="w-24 h-2 rounded-full bg-slate-700 overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${
                                                                tokenPct < 20 ? 'bg-red-500' : tokenPct < 50 ? 'bg-amber-500' : 'bg-emerald-500'
                                                            }`}
                                                            style={{ width: `${tokenPct}%` }}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className={`text-sm font-mono ${suspicious ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                                                        {device.hit_count_5min}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {isBanned ? (
                                                            canUpdate && (
                                                                <button
                                                                    onClick={() => handleUnban(device.device_id)}
                                                                    title="解封设备"
                                                                    className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium flex items-center gap-1 transition-colors"
                                                                >
                                                                    <Unlock className="w-3 h-3" />
                                                                    解封
                                                                </button>
                                                            )
                                                        ) : (
                                                            canUpdate && (
                                                                <button
                                                                    onClick={() => {
                                                                        setBanDeviceId(device.device_id);
                                                                        setShowBanModal(true);
                                                                    }}
                                                                    title="临时封禁"
                                                                    className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium flex items-center gap-1 transition-colors"
                                                                >
                                                                    <Ban className="w-3 h-3" />
                                                                    封禁
                                                                </button>
                                                            )
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                            <Activity className="w-10 h-10 text-slate-700 mb-2" />
                            <p className="text-slate-400 text-sm">暂无设备上报数据</p>
                            <p className="text-xs text-slate-600 mt-1">传感器上报数据后，令牌桶状态将实时显示</p>
                        </div>
                    )}
                </section>

                {stats?.banned_devices?.length > 0 && (
                    <section className="glass-card rounded-3xl p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <Ban className="w-5 h-5 text-red-400" />
                            <h2 className="text-xl font-semibold text-white">封禁设备列表</h2>
                        </div>
                        <div className="space-y-2">
                            {stats.banned_devices.map((ban) => (
                                <div key={ban.id} className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                                    <div className="flex items-center gap-3">
                                        <Ban className="w-4 h-4 text-red-400" />
                                        <div>
                                            <span className="text-sm font-medium text-white">{ban.device_id}</span>
                                            <span className="text-xs text-slate-500 ml-2">
                                                {ban.reason || '无原因'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-xs text-slate-500">
                                            {ban.expires_at ? `至 ${new Date(ban.expires_at).toLocaleString('zh-CN')}` : '永久封禁'}
                                        </div>
                                        {canUpdate && (
                                            <button
                                                onClick={() => handleUnban(ban.device_id)}
                                                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium flex items-center gap-1 transition-colors"
                                            >
                                                <Unlock className="w-3 h-3" />
                                                解封
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
                            <h3 className="text-xl font-semibold text-white">
                                {editingRule ? '编辑限流规则' : '新建限流规则'}
                            </h3>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">规则名称 *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="如：温度传感器默认限流"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white placeholder-slate-600 transition-all"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">业务路径模式</label>
                                    <input
                                        type="text"
                                        value={formData.path_pattern}
                                        onChange={(e) => setFormData({ ...formData, path_pattern: e.target.value })}
                                        placeholder="/api/sensor-data"
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">支持通配符，如 /api/sensor*</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">设备ID匹配模式</label>
                                    <input
                                        type="text"
                                        value={formData.device_id_pattern}
                                        onChange={(e) => setFormData({ ...formData, device_id_pattern: e.target.value })}
                                        placeholder="* 或 sensor-* 或 *-temp"
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">* 匹配所有，sensor-* 前缀匹配</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">IP段（批量配置）</label>
                                <input
                                    type="text"
                                    value={formData.ip_range}
                                    onChange={(e) => setFormData({ ...formData, ip_range: e.target.value })}
                                    placeholder="如 192.168.1.0/24 或 10.0.0.1"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                />
                                <p className="text-xs text-slate-500 mt-1">支持CIDR格式，留空表示匹配所有IP</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">令牌/分钟（限流阈值）</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.rate_limit}
                                        onChange={(e) => setFormData({ ...formData, rate_limit: parseInt(e.target.value) || 1 })}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">突发容量</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.burst}
                                        onChange={(e) => setFormData({ ...formData, burst: parseInt(e.target.value) || 1 })}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-rose-500 outline-none text-white transition-all"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                    <div className={`relative w-11 h-6 rounded-full transition-colors ${formData.is_enabled ? 'bg-rose-600' : 'bg-slate-700'}`}>
                                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${formData.is_enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={formData.is_enabled}
                                        onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                                        className="sr-only"
                                    />
                                    <span className="text-sm text-slate-300">创建后立即启用</span>
                                </label>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {editingRule ? '保存修改' : '创建规则'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showBanModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-slate-700">
                            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                                <Ban className="w-5 h-5 text-red-400" />
                                临时封禁设备
                            </h3>
                            <button
                                onClick={() => { setShowBanModal(false); setBanDeviceId(''); setBanReason(''); setBanDuration(''); }}
                                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">设备ID *</label>
                                <input
                                    type="text"
                                    value={banDeviceId}
                                    onChange={(e) => setBanDeviceId(e.target.value)}
                                    placeholder="输入要封禁的设备ID"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-red-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">封禁原因</label>
                                <input
                                    type="text"
                                    value={banReason}
                                    onChange={(e) => setBanReason(e.target.value)}
                                    placeholder="如：异常高频上报"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-red-500 outline-none text-white placeholder-slate-600 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">封禁时长（分钟）</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={banDuration}
                                    onChange={(e) => setBanDuration(e.target.value)}
                                    placeholder="留空则永久封禁"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-red-500 outline-none text-white placeholder-slate-600 transition-all"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => { setShowBanModal(false); setBanDeviceId(''); setBanReason(''); setBanDuration(''); }}
                                    className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleBan}
                                    disabled={banning}
                                    className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    {banning && <Loader2 className="w-4 h-4 animate-spin" />}
                                    <Ban className="w-4 h-4" />
                                    确认封禁
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SensorFlowControl;
