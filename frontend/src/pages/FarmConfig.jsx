import { useState, useEffect, useCallback } from 'react';
import { configApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    Settings,
    ToggleLeft,
    ToggleRight,
    ChevronDown,
    ChevronUp,
    Clock,
    User,
    RefreshCw,
    AlertTriangle,
    Check,
    X,
    Sliders,
    Thermometer,
    ShieldAlert,
    CalendarClock,
    Wifi,
    Bell,
    Monitor,
    Gauge,
} from 'lucide-react';
import { toast } from 'react-toastify';

const CATEGORY_ICONS = {
    temperature_alert: Thermometer,
    inspection: CalendarClock,
    sensor: Wifi,
    notification: Bell,
    system: Monitor,
    rate_limit: Gauge,
};

const CATEGORY_COLORS = {
    temperature_alert: {
        bg: 'bg-orange-500/20',
        text: 'text-orange-400',
        border: 'border-orange-500/30',
        hover: 'hover:bg-orange-500/10 hover:border-orange-500/30',
    },
    inspection: {
        bg: 'bg-violet-500/20',
        text: 'text-violet-400',
        border: 'border-violet-500/30',
        hover: 'hover:bg-violet-500/10 hover:border-violet-500/30',
    },
    sensor: {
        bg: 'bg-cyan-500/20',
        text: 'text-cyan-400',
        border: 'border-cyan-500/30',
        hover: 'hover:bg-cyan-500/10 hover:border-cyan-500/30',
    },
    notification: {
        bg: 'bg-amber-500/20',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
        hover: 'hover:bg-amber-500/10 hover:border-amber-500/30',
    },
    system: {
        bg: 'bg-slate-500/20',
        text: 'text-slate-400',
        border: 'border-slate-500/30',
        hover: 'hover:bg-slate-500/10 hover:border-slate-500/30',
    },
    rate_limit: {
        bg: 'bg-rose-500/20',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
        hover: 'hover:bg-rose-500/10 hover:border-rose-500/30',
    },
};

function BooleanControl({ value, onChange, disabled }) {
    const isTrue = value === 'true' || value === true || value === '1';
    return (
        <button
            onClick={() => !disabled && onChange(isTrue ? 'false' : 'true')}
            disabled={disabled}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                isTrue ? 'bg-emerald-500' : 'bg-slate-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    isTrue ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
        </button>
    );
}

function NumberControl({ value, onChange, min, max, step, disabled }) {
    const handleChange = (e) => {
        const val = e.target.value;
        if (val === '' || val === '-') {
            onChange(val);
            return;
        }
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
            if (min !== undefined && numVal < min) return;
            if (max !== undefined && numVal > max) return;
            onChange(val);
        }
    };

    return (
        <input
            type="number"
            value={value}
            onChange={handleChange}
            disabled={disabled}
            min={min}
            max={max}
            step={step || 1}
            className="w-32 px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
        />
    );
}

function StringControl({ value, onChange, disabled }) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
        />
    );
}

function SelectControl({ value, onChange, options, disabled }) {
    return (
        <div className="relative">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 pr-8 rounded-xl bg-slate-800/50 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
            >
                {options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
    );
}

function SliderControl({ value, onChange, min, max, step, disabled }) {
    const numVal = parseFloat(value) || 0;
    const percentage = min !== undefined && max !== undefined
        ? ((numVal - min) / (max - min)) * 100
        : 0;

    return (
        <div className="flex items-center gap-3 w-full">
            <span className="text-xs text-slate-400 w-12 text-right">{min}</span>
            <div className="flex-1 relative">
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full"
                        style={{ width: `${percentage}%` }}
                    />
                </div>
                <input
                    type="range"
                    value={numVal}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    min={min}
                    max={max}
                    step={step || 1}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                />
            </div>
            <span className="text-xs text-slate-400 w-12">{max}</span>
            <span className="text-sm font-medium text-white w-16 text-right">{value}</span>
        </div>
    );
}

function ConfigCard({ config, onEdit, expanded, onToggleExpand, canUpdate }) {
    const colors = CATEGORY_COLORS[config.category] || CATEGORY_COLORS.system;
    const IconComponent = CATEGORY_ICONS[config.category] || Settings;

    const renderControl = () => {
        const props = {
            value: config.value,
            onChange: (val) => onEdit(config.id, val),
            disabled: !canUpdate,
            min: config.min_value,
            max: config.max_value,
            step: config.step,
            options: config.options,
        };

        switch (config.value_type) {
            case 'boolean':
                return <BooleanControl {...props} />;
            case 'number':
                return <NumberControl {...props} />;
            case 'string':
                return <StringControl {...props} />;
            case 'select':
                return <SelectControl {...props} />;
            case 'slider':
                return <SliderControl {...props} />;
            default:
                return <StringControl {...props} />;
        }
    };

    return (
        <div className={`rounded-2xl border bg-slate-800/50 border-slate-700 overflow-hidden transition-all`}>
            <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                        <div className={`p-2.5 rounded-xl ${colors.bg} shrink-0`}>
                            <IconComponent className={`w-5 h-5 ${colors.text}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="font-medium text-white">{config.name}</h3>
                                <span className={`px-2 py-0.5 rounded-md text-xs ${colors.bg} ${colors.text}`}>
                                    {config.value_type_name}
                                </span>
                            </div>
                            <p className="text-sm text-slate-400 mt-1">{config.description}</p>
                            {config.last_modified_by_username && (
                                <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                    <User className="w-3 h-3" />
                                    <span>最近修改：{config.last_modified_by_username}</span>
                                    <Clock className="w-3 h-3 ml-2" />
                                    <span>{new Date(config.updated_at).toLocaleString('zh-CN')}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="shrink-0">
                        {config.value_type === 'boolean' ? (
                            renderControl()
                        ) : null}
                    </div>
                </div>

                {config.value_type !== 'boolean' && (
                    <div className="mt-4">
                        {renderControl()}
                    </div>
                )}
            </div>

            <button
                onClick={() => onToggleExpand(config.id)}
                className="w-full px-4 py-2.5 border-t border-slate-700 flex items-center justify-between text-sm text-slate-400 hover:text-slate-300 hover:bg-slate-700/30 transition-colors"
            >
                <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    变更记录
                </span>
                {expanded ? (
                    <ChevronUp className="w-4 h-4" />
                ) : (
                    <ChevronDown className="w-4 h-4" />
                )}
            </button>

            {expanded && <ChangeLogs configId={config.id} />}
        </div>
    );
}

function ChangeLogs({ configId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchLogs = async () => {
            setLoading(true);
            try {
                const res = await configApi.getChangeLogs(configId, 5);
                setLogs(res.data.items || []);
            } catch (err) {
                console.error('Failed to fetch change logs:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, [configId]);

    if (loading) {
        return (
            <div className="px-4 py-6 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
                暂无变更记录
            </div>
        );
    }

    return (
        <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-900/30">
            <div className="space-y-3">
                {logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-sm">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-slate-300 font-medium">
                                    {log.changed_by_username}
                                </span>
                                <span className="text-slate-500 text-xs">
                                    {new Date(log.created_at).toLocaleString('zh-CN')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-xs">
                                <span className="text-slate-500">旧值:</span>
                                <span className="text-rose-400 line-through">{log.old_value ?? '—'}</span>
                                <span className="text-slate-600">→</span>
                                <span className="text-slate-500">新值:</span>
                                <span className="text-emerald-400 font-medium">{log.new_value}</span>
                            </div>
                            {log.change_reason && (
                                <p className="text-xs text-slate-500 mt-1">
                                    原因: {log.change_reason}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ConfirmModal({ isOpen, onClose, onConfirm, config, newValue }) {
    if (!isOpen || !config) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 rounded-xl bg-amber-500/20">
                            <AlertTriangle className="w-6 h-6 text-amber-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">确认修改配置</h3>
                            <p className="text-sm text-slate-400">{config.name}</p>
                        </div>
                    </div>

                    <div className="bg-slate-900/50 rounded-xl p-4 mb-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">当前值</p>
                                <p className="text-lg font-medium text-slate-300 line-through">{config.value}</p>
                            </div>
                            <div className="text-slate-500">
                                <ChevronDown className="w-5 h-5 rotate-[-90deg]" />
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-slate-500 mb-1">新值</p>
                                <p className="text-lg font-semibold text-emerald-400">{newValue}</p>
                            </div>
                        </div>
                    </div>

                    <p className="text-sm text-slate-400">
                        修改后将即时生效，系统将立即应用新的配置值。是否确认？
                    </p>
                </div>

                <div className="flex border-t border-slate-700">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3.5 text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors font-medium text-sm"
                    >
                        取消
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-4 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" />
                        确认修改
                    </button>
                </div>
            </div>
        </div>
    );
}

function FarmConfig() {
    const { user, hasPermission } = useAuth();
    const canRead = hasPermission('read');
    const canUpdate = hasPermission('update');

    const [configs, setConfigs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [scope, setScope] = useState('global');
    const [expandedIds, setExpandedIds] = useState([]);
    const [pendingChange, setPendingChange] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const fetchConfigs = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        try {
            const res = await configApi.list({ scope });
            setConfigs(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) {
                toast.error('获取配置列表失败');
            }
        } finally {
            setLoading(false);
        }
    }, [canRead, scope]);

    useEffect(() => {
        fetchConfigs();
    }, [fetchConfigs]);

    const groupedConfigs = configs.reduce((acc, config) => {
        if (!acc[config.category]) {
            acc[config.category] = [];
        }
        acc[config.category].push(config);
        return acc;
    }, {});

    const handleEdit = (configId, newValue) => {
        const config = configs.find((c) => c.id === configId);
        if (!config) return;
        if (config.value === newValue) return;

        setPendingChange({ configId, newValue, config });
        setConfirmOpen(true);
    };

    const handleConfirm = async () => {
        if (!pendingChange) return;
        setSubmitting(true);
        try {
            await configApi.update(pendingChange.configId, {
                value: pendingChange.newValue,
                change_reason: '通过配置中心页面修改',
            });
            toast.success('配置修改成功，已即时生效');
            await fetchConfigs();
        } catch (err) {
            toast.error(err.response?.data?.detail || '配置修改失败');
        } finally {
            setSubmitting(false);
            setConfirmOpen(false);
            setPendingChange(null);
        }
    };

    const handleCancel = () => {
        setConfirmOpen(false);
        setPendingChange(null);
    };

    const toggleExpand = (configId) => {
        setExpandedIds((prev) =>
            prev.includes(configId)
                ? prev.filter((id) => id !== configId)
                : [...prev, configId]
        );
    };

    const categoryOrder = [
        'temperature_alert',
        'inspection',
        'sensor',
        'notification',
        'system',
        'rate_limit',
    ];

    const categoryNames = {
        temperature_alert: '温度告警',
        inspection: '巡检管理',
        sensor: '传感器',
        notification: '通知告警',
        system: '系统设置',
        rate_limit: '限流设置',
    };

    return (
        <div className="min-h-screen bg-slate-900">
            <div className="max-w-6xl mx-auto px-4 py-6">
                <Header />

                <div className="mt-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20">
                                <Sliders className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white">蜂场配置</h1>
                                <p className="text-sm text-slate-400">动态配置中心，修改后即时生效</p>
                            </div>
                        </div>
                        <button
                            onClick={fetchConfigs}
                            disabled={loading}
                            className="p-2.5 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all group disabled:opacity-50"
                            title="刷新配置"
                        >
                            <RefreshCw className={`w-5 h-5 text-slate-400 group-hover:text-blue-400 transition-colors ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 mb-6">
                        <button
                            onClick={() => setScope('global')}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                scope === 'global'
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                    : 'bg-slate-800/50 text-slate-400 hover:text-white border border-slate-700'
                            }`}
                        >
                            全局配置
                        </button>
                        <button
                            onClick={() => setScope('farm')}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                scope === 'farm'
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                                    : 'bg-slate-800/50 text-slate-400 hover:text-white border border-slate-700'
                            }`}
                        >
                            蜂场配置
                        </button>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : configs.length === 0 ? (
                        <div className="text-center py-20">
                            <Settings className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                            <p className="text-slate-400">暂无配置项</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {categoryOrder
                                .filter((cat) => groupedConfigs[cat]?.length > 0)
                                .map((category) => {
                                    const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.system;
                                    const IconComponent = CATEGORY_ICONS[category] || Settings;

                                    return (
                                        <section key={category}>
                                            <div className="flex items-center gap-2 mb-4">
                                                <div className={`p-2 rounded-lg ${colors.bg}`}>
                                                    <IconComponent className={`w-4 h-4 ${colors.text}`} />
                                                </div>
                                                <h2 className="text-lg font-semibold text-white">
                                                    {categoryNames[category] || category}
                                                </h2>
                                                <span className="text-sm text-slate-500">
                                                    ({groupedConfigs[category].length}项)
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                                {groupedConfigs[category].map((config) => (
                                                    <ConfigCard
                                                        key={config.id}
                                                        config={config}
                                                        onEdit={handleEdit}
                                                        expanded={expandedIds.includes(config.id)}
                                                        onToggleExpand={toggleExpand}
                                                        canUpdate={canUpdate}
                                                    />
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                        </div>
                    )}
                </div>
            </div>

            <ConfirmModal
                isOpen={confirmOpen && !submitting}
                onClose={handleCancel}
                onConfirm={handleConfirm}
                config={pendingChange?.config}
                newValue={pendingChange?.newValue}
            />

            {submitting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-slate-800 border border-slate-700">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-white font-medium">保存中...</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default FarmConfig;
