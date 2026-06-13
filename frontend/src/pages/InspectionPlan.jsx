import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { inspectionPlanApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    CalendarClock,
    Plus,
    Play,
    Power,
    PowerOff,
    Edit3,
    Trash2,
    X,
    Check,
    Clock,
    Box,
    History,
    ChevronRight,
    Sparkles,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    User,
    TimerReset,
    Loader2,
} from 'lucide-react';
import { toast } from 'react-toastify';

const SEASON_COLORS = {
    spring: 'bg-green-500/20 text-green-400 border-green-500/30',
    autumn: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    winter: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    custom: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const EXEC_STATUS_COLORS = {
    success: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    partial: 'bg-amber-500/15 text-amber-400',
};

const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const getCountdown = (nextRunAt) => {
    if (!nextRunAt) return null;
    const now = new Date();
    const next = new Date(nextRunAt);
    const diffMs = next - now;
    if (diffMs <= 0) return '即将执行';
    const diffSecs = Math.floor(diffMs / 1000);
    const days = Math.floor(diffSecs / 86400);
    const hours = Math.floor((diffSecs % 86400) / 3600;
    const minutes = Math.floor((diffSecs % 3600) / 60;
    const seconds = diffSecs % 60;
    if (days > 0) return `${days}天${hours}小时后`;
    if (hours > 0) return `${hours}小时${minutes}分后`;
    if (minutes > 0) return `${minutes}分${seconds}秒后`;
    return `${seconds}秒后`;
};

const defaultFormData = {
    name: '',
    season: 'custom',
    cron_expression: '0 9 * * *',
    filter_conditions: {},
    checklist_items: [],
    is_enabled: true,
    description: '',
};

function InspectionPlan() {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const canRead = hasPermission('read');
    const canCreate = hasPermission('create');
    const canUpdate = hasPermission('update');
    const canDelete = hasPermission('delete');

    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(false);
    const [executionLogs, setExecutionLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [, setTick] = useState(0);

    const [showModal, setShowModal] = useState(false);
    const [editingPlan, setEditingPlan] = useState(null);
    const [formData, setFormData] = useState({ ...defaultFormData });
    const [templates, setTemplates] = useState([]);
    const [cronParse, setCronParse] = useState(null);
    const [cronParsing, setCronParsing] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [newChecklistItem, setNewChecklistItem] = useState('');

    const fetchPlans = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        try {
            const res = await inspectionPlanApi.list();
            setPlans(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取巡检计划列表失败');
        } finally {
            setLoading(false);
        }
    }, [canRead]);

    const fetchExecutionLogs = useCallback(async () => {
        if (!canRead) return;
        setLogsLoading(true);
        try {
            const res = await inspectionPlanApi.getExecutionLogs({ limit: 50 });
            setExecutionLogs(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取执行历史失败');
        } finally {
            setLogsLoading(false);
        }
    }, [canRead]);

    const fetchTemplates = useCallback(async () => {
        try {
            const res = await inspectionPlanApi.getTemplates();
            setTemplates(res.data || []);
        } catch (_) { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchPlans();
        fetchExecutionLogs();
        fetchTemplates();
    }, [fetchPlans, fetchExecutionLogs, fetchTemplates]);

    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1),
        return () => clearInterval(interval);
    }, []);

    const parseCronDebounced = useCallback(
        debounce(async (expr) => {
            if (!expr || !expr.trim()) {
                setCronParse(null);
                return;
            }
            setCronParsing(true);
            try {
                const res = await inspectionPlanApi.parseCron(expr.trim());
                setCronParse(res.data);
            } catch (_) {
                setCronParse({ is_valid: false, error_message: '解析失败' });
            } finally {
                setCronParsing(false);
            }
        }, 400),
        []
    );

    useEffect(() => {
        if (showModal) {
            parseCronDebounced(formData.cron_expression);
        }
    }, [formData.cron_expression, showModal, parseCronDebounced]);

    const openCreateModal = () => {
        setEditingPlan(null);
        setFormData({ ...defaultFormData });
        setCronParse(null);
        setShowModal(true);
    };

    const openEditModal = (plan) => {
        setEditingPlan(plan);
        setFormData({
            name: plan.name,
            season: plan.season,
            cron_expression: plan.cron_expression,
            filter_conditions: plan.filter_conditions || {},
            checklist_items: [...(plan.checklist_items || [])],
            is_enabled: plan.is_enabled,
            description: plan.description || '',
        });
        setCronParse(null);
        setShowModal(true);
    };

    const applyTemplate = (tpl) => {
        setFormData({
            ...formData,
            name: tpl.name,
            season: tpl.season,
            cron_expression: tpl.cron_expression,
            description: tpl.description,
            checklist_items: [...tpl.checklist_items],
        });
        toast.success(`已应用${tpl.season_name}模板`);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.name.trim()) {
            toast.warning('请输入计划名称');
            return;
        }
        if (!formData.cron_expression || !formData.cron_expression.trim()) {
            toast.warning('请输入Cron表达式');
            return;
        }
        if (!cronParse?.is_valid) {
            toast.warning('Cron表达式无效');
            return;
        }
        setSubmitting(true);
        try {
            if (editingPlan) {
                await inspectionPlanApi.update(editingPlan.id, formData);
                toast.success('计划更新成功');
            } else {
                await inspectionPlanApi.create(formData);
                toast.success('计划创建成功');
            }
            setShowModal(false);
            fetchPlans();
            fetchExecutionLogs();
        } catch (err) {
            toast.error(err.response?.data?.detail || '保存失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggle = async (plan) => {
        try {
            await inspectionPlanApi.toggle(plan.id);
            toast.success(plan.is_enabled ? '已禁用' : '已启用');
            fetchPlans();
        } catch (err) {
            toast.error('操作失败');
        }
    };

    const handleTrigger = async (plan) => {
        try {
            await inspectionPlanApi.trigger(plan.id);
            toast.success('已触发执行，请稍后查看执行历史');
            setTimeout(() => fetchExecutionLogs(), 2000);
        } catch (err) {
            toast.error('触发失败');
        }
    };

    const handleDelete = async (plan) => {
        if (!window.confirm(`确定删除计划"${plan.name}"？`)) return;
        try {
            await inspectionPlanApi.remove(plan.id);
            toast.success('删除成功');
            fetchPlans();
        } catch (err) {
            toast.error('删除失败');
        }
    };

    const addChecklistItem = () => {
        const item = newChecklistItem.trim();
        if (!item) return;
        setFormData({
            ...formData,
            checklist_items: [...formData.checklist_items, item],
        });
        setNewChecklistItem('');
    };

    const removeChecklistItem = (idx) => {
        setFormData({
            ...formData,
            checklist_items: formData.checklist_items.filter((_, i) => i !== idx),
        });
    };

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-6xl mx-auto space-y-8">
                <Header />

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-violet-600 rounded-2xl shadow-lg shadow-violet-500/20">
                            <CalendarClock className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">巡检计划</h1>
                            <p className="text-sm text-slate-400">按春繁、秋繁、越冬等节气节点自动生成蜂箱巡检任务</p>
                        </div>
                    </div>
                    {canCreate && (
                        <button
                            onClick={openCreateModal}
                            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium flex items-center gap-2 transition-colors shadow-lg shadow-violet-500/20"
                        >
                            <Plus className="w-4 h-4" />
                            新建计划
                        </button>
                    )}
                </div>

                <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                            <CalendarClock className="w-5 h-5 text-violet-400" />
                            <h2 className="text-xl font-semibold text-white">计划列表</h2>
                        </div>
                        <span className="text-sm text-slate-400">
                            共 <span className="text-white font-medium">{plans.length}</span> 个计划
                        </span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
                        </div>
                    ) : plans.length > 0 ? (
                        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-slate-800/50 text-slate-400 text-sm">
                                        <th className="px-5 py-4 font-medium">计划名称</th>
                                        <th className="px-5 py-4 font-medium">季节</th>
                                        <th className="px-5 py-4 font-medium">Cron 表达式</th>
                                        <th className="px-5 py-4 font-medium">下次执行</th>
                                        <th className="px-5 py-4 font-medium">影响蜂箱</th>
                                        <th className="px-5 py-4 font-medium">状态</th>
                                        <th className="px-5 py-4 font-medium text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {plans.map((plan) => {
                                        const countdown = getCountdown(plan.next_run_at);
                                        return (
                                            <tr key={plan.id} className="hover:bg-slate-800/30 transition-colors">
                                                <td className="px-5 py-4">
                                                    <div className="font-medium text-white">{plan.name}</div>
                                                    {plan.description && (
                                                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                                                            {plan.description}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-5 py-4">
                                                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${SEASON_COLORS[plan.season] || SEASON_COLORS.custom}`}>
                                                        {plan.season_name}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <code className="text-xs bg-slate-800 px-2 py-1 rounded text-violet-300 font-mono">
                                                        {plan.cron_expression}
                                                    </code>
                                                </td>
                                                <td className="px-5 py-4">
                                                    {plan.is_enabled && plan.next_run_at ? (
                                                        <div>
                                                            <div className="text-sm text-white flex items-center gap-1.5">
                                                                <TimerReset className="w-3.5 h-3.5 text-violet-400" />
                                                                {countdown}
                                                            </div>
                                                            <div className="text-xs text-slate-500 mt-0.5">
                                                                {formatDateTime(plan.next_run_at)}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-slate-600">未启用</span>
                                                    )}
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <Box className="w-3.5 h-3.5 text-emerald-400" />
                                                        <span className="text-sm text-white">{plan.affected_hive_count}</span>
                                                        <span className="text-xs text-slate-500">个</span>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                                                        plan.is_enabled
                                                            ? 'bg-emerald-500/15 text-emerald-400'
                                                            : 'bg-slate-500/15 text-slate-400'
                                                    }`}>
                                                        {plan.is_enabled ? (
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
                                                                    onClick={() => handleTrigger(plan)}
                                                                    title="立即执行"
                                                                    className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                                                >
                                                                    <Play className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleToggle(plan)}
                                                                    title={plan.is_enabled ? '禁用' : '启用'}
                                                                    className={`p-2 rounded-lg transition-colors ${
                                                                        plan.is_enabled
                                                                            ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                                                            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                                                    }`}
                                                                >
                                                                    {plan.is_enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                                                                </button>
                                                                <button
                                                                    onClick={() => openEditModal(plan)}
                                                                    title="编辑"
                                                                    className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                                                >
                                                                    <Edit3 className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDelete(plan)}
                                                                title="删除"
                                                                className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
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
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <CalendarClock className="w-12 h-12 text-slate-700 mb-3" />
                            <p className="text-slate-400">暂无巡检计划</p>
                            <p className="text-xs text-slate-600 mt-1">点击右上角"新建计划"开始创建</p>
                        </div>
                    )}
                </section>

                <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <History className="w-5 h-5 text-amber-400" />
                        <h2 className="text-xl font-semibold text-white">执行历史</h2>
                        <span className="text-sm text-slate-400">（最近 50 条）</span>
                    </div>

                    {logsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                        </div>
                    ) : executionLogs.length > 0 ? (
                        <div className="relative">
                            <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-700" />
                            <div className="space-y-4">
                                {executionLogs.map((log) => {
                                    const StatusIcon =
                                        log.status === 'success' ? CheckCircle2 :
                                        log.status === 'failed' ? XCircle : AlertTriangle;
                                    return (
                                        <div key={log.id} className="relative pl-10">
                                            <div className={`absolute left-2 top-1 w-5 h-5 rounded-full flex items-center justify-center ${EXEC_STATUS_COLORS[log.status]}`}>
                                                <StatusIcon className="w-3 h-3" />
                                            </div>
                                            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4">
                                                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-white">{log.plan_name}</span>
                                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${EXEC_STATUS_COLORS[log.status]}`}>
                                                            {log.status_name}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-slate-500">
                                                        <Clock className="w-3 h-3" />
                                                        {formatDateTime(log.started_at)}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                                                    <div className="flex items-center gap-1">
                                                        <Box className="w-3.5 h-3.5" />
                                                        共 <span className="text-white">{log.total_hives}</span> 个蜂箱
                                                    </div>
                                                    <div className="flex items-center gap-1 text-emerald-400">
                                                        <Check className="w-3.5 h-3.5" />
                                                        成功 {log.success_hives}
                                                    </div>
                                                    {log.failed_hives > 0 && (
                                                        <div className="flex items-center gap-1 text-red-400">
                                                            <X className="w-3.5 h-3.5" />
                                                            失败 {log.failed_hives}
                                                        </div>
                                                    )}
                                                    {log.duration_seconds !== undefined && log.duration_seconds !== null && (
                                                        <div className="flex items-center gap-1">
                                                            <TimerReset className="w-3.5 h-3.5" />
                                                            耗时 {log.duration_seconds.toFixed(1)}s
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-1">
                                                        <User className="w-3.5 h-3.5" />
                                                        {log.triggered_by?.startsWith('manual:')
                                                            ? `手动触发：${log.triggered_by.split(':')[1]}`
                                                            : '调度器自动'}
                                                    </div>
                                                </div>
                                                {log.error_message && (
                                                    <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                                                        {log.error_message}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                            <History className="w-10 h-10 text-slate-700 mb-2" />
                            <p className="text-slate-400 text-sm">暂无执行记录</p>
                        </div>
                    )}
                </section>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
                            <h3 className="text-xl font-semibold text-white">
                                {editingPlan ? '编辑巡检计划' : '新建巡检计划'}
                            </h3>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {!editingPlan && templates.length > 0 && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-1.5">
                                        <Sparkles className="w-4 h-4 text-violet-400" />
                                        快捷模板
                                    </label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {templates.map((tpl) => (
                                            <button
                                                key={tpl.season}
                                                type="button"
                                                onClick={() => applyTemplate(tpl)}
                                                className="p-3 rounded-xl border text-left transition-all hover:scale-[1.02] border-slate-700 hover:border-violet-500/50 bg-slate-800 hover:bg-violet-500/10"
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${SEASON_COLORS[tpl.season]}`}>
                                                        {tpl.season_name}
                                                    </span>
                                                </div>
                                                <div className="text-sm font-medium text-white mt-1.5">{tpl.name}</div>
                                                <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{tpl.description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="h-px bg-slate-700/50 my-4" />
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">计划名称 *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="如：春繁定期巡检"
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white placeholder-slate-600 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">季节类型</label>
                                    <select
                                        value={formData.season}
                                        onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white transition-all"
                                    >
                                        <option value="spring">春繁</option>
                                        <option value="autumn">秋繁</option>
                                        <option value="winter">越冬</option>
                                        <option value="custom">自定义</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">Cron 表达式 *</label>
                                <input
                                    type="text"
                                    value={formData.cron_expression}
                                    onChange={(e) => setFormData({ ...formData, cron_expression: e.target.value })}
                                    placeholder="如：0 9 1,15 3,4 *  表示3、4月的1日和15日早上9点"
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-sm"
                                />
                                <div className="mt-2 min-h-[20px]">
                                    {cronParsing ? (
                                        <span className="text-xs text-slate-500 flex items-center gap-1">
                                            <Loader2 className="w-3 h-3 animate-spin" /> 解析中...
                                        </span>
                                    ) : cronParse ? (
                                        cronParse.is_valid ? (
                                            <span className="text-xs text-emerald-400 flex items-center gap-1">
                                                <Check className="w-3 h-3" />
                                                下一次将在 <span className="text-white font-medium">{formatDateTime(cronParse.next_run_at)}</span> 触发
                                            </span>
                                        ) : (
                                            <span className="text-xs text-red-400 flex items-center gap-1">
                                                <X className="w-3 h-3" />
                                                {cronParse.error_message || '表达式无效'}
                                            </span>
                                        )
                                    ) : null}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    格式：分 时 日 月 周 &nbsp;|&nbsp; 示例：<code className="bg-slate-800 px-1.5 py-0.5 rounded">0 9 * * *</code> 每天9点，
                                    <code className="bg-slate-800 px-1.5 py-0.5 rounded">0 9 1 * *</code> 每月1日9点
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">蜂箱筛选条件（JSON）</label>
                                <textarea
                                    value={JSON.stringify(formData.filter_conditions, null, 2)}
                                    onChange={(e) => {
                                        try {
                                            const val = JSON.parse(e.target.value || '{}');
                                            setFormData({ ...formData, filter_conditions: val });
                                        } catch (_) { /* ignore parse error while typing */ }
                                    }}
                                    placeholder='{"apiary_id": "xxx", "strength_levels": ["strong", "very_strong"]}'
                                    rows={3}
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white placeholder-slate-600 transition-all font-mono text-xs"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    支持字段：apiary_id（蜂场ID）、strength_levels（群势等级数组）、bee_species（蜂种）、min_strength（最小群势）
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">巡检清单</label>
                                <div className="space-y-2">
                                    {formData.checklist_items.map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                            <div className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white flex items-center gap-2">
                                                <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />
                                                {item}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeChecklistItem(idx)}
                                                className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={newChecklistItem}
                                            onChange={(e) => setNewChecklistItem(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                                            placeholder="输入巡检项，回车添加"
                                            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white placeholder-slate-600 transition-all text-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={addChecklistItem}
                                            className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
                                        >
                                            添加
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">描述</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="计划说明..."
                                    rows={2}
                                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-violet-500 outline-none text-white placeholder-slate-600 transition-all"
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                    <div className={`relative w-11 h-6 rounded-full transition-colors ${formData.is_enabled ? 'bg-violet-600' : 'bg-slate-700'}`}>
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
                                    className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {editingPlan ? '保存修改' : '创建计划'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

export default InspectionPlan;
