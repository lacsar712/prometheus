import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    ScrollText,
    Search,
    Filter,
    ChevronLeft,
    ChevronRight,
    X,
    Download,
    Calendar,
    User,
    Box,
    Tag,
    Clock,
    Globe,
    Info,
    ChevronDown,
    Check,
    ArrowLeft,
    Home,
} from 'lucide-react';
import { toast } from 'react-toastify';

const OPERATION_TYPE_COLORS = {
    open_box: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    harvest: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    queen_change: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    relocate: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    retire: 'bg-red-500/20 text-red-400 border-red-500/30',
    create: 'bg-green-500/20 text-green-400 border-green-500/30',
    update: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    inspection: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
};

function jsonSyntaxHighlight(json) {
    if (!json) return '';
    try {
        const obj = typeof json === 'string' ? JSON.parse(json) : json;
        const jsonStr = JSON.stringify(obj, null, 2);
        return jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'text-emerald-400';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'text-blue-400';
                } else {
                    cls = 'text-emerald-400';
                }
            } else if (/true|false/.test(match)) {
                cls = 'text-purple-400';
            } else if (/null/.test(match)) {
                cls = 'text-red-400';
            } else {
                cls = 'text-amber-400';
            }
            return `<span class="${cls}">${match}</span>`;
        });
    } catch {
        return json;
    }
}

function BeehiveOperationLog() {
    const { user, hasPermission } = useAuth();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedLog, setSelectedLog] = useState(null);
    const [operators, setOperators] = useState([]);
    const [operationTypes, setOperationTypes] = useState([]);
    const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
    const [operatorDropdownOpen, setOperatorDropdownOpen] = useState(false);

    const [filters, setFilters] = useState({
        operatorId: '',
        hiveCode: '',
        operationTypes: [],
        startTime: '',
        endTime: '',
    });

    const canAudit = hasPermission('audit');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', page);
            params.append('size', pageSize);
            if (filters.operatorId) params.append('operator_id', filters.operatorId);
            if (filters.hiveCode) params.append('hive_code', filters.hiveCode);
            if (filters.operationTypes.length > 0) params.append('operation_types', filters.operationTypes.join(','));
            if (filters.startTime) params.append('start_time', filters.startTime);
            if (filters.endTime) params.append('end_time', filters.endTime);

            const response = await api.get(`/api/operation-logs?${params.toString()}`);
            setLogs(response.data.items);
            setTotal(response.data.total);
        } catch (error) {
            if (error.response?.status !== 403) {
                toast.error('获取操作日志失败');
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchMeta = async () => {
        try {
            const [opsRes, typesRes] = await Promise.all([
                api.get('/api/operation-logs/meta/operators'),
                api.get('/api/operation-logs/meta/operation-types'),
            ]);
            setOperators(opsRes.data);
            setOperationTypes(typesRes.data);
        } catch (error) {
            console.error('Failed to fetch meta data:', error);
        }
    };

    useEffect(() => {
        fetchMeta();
    }, []);

    useEffect(() => {
        fetchLogs();
    }, [page, pageSize]);

    const handleSearch = () => {
        setPage(1);
        fetchLogs();
    };

    const handleReset = () => {
        setFilters({
            operatorId: '',
            hiveCode: '',
            operationTypes: [],
            startTime: '',
            endTime: '',
        });
        setPage(1);
        setTimeout(fetchLogs, 0);
    };

    const handleRowClick = (log) => {
        setSelectedLog(log);
        setDrawerOpen(true);
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(new Set(logs.map(l => l.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (e, id) => {
        e.stopPropagation();
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleExport = async (selectedOnly = false) => {
        try {
            const params = new URLSearchParams();
            if (selectedOnly && selectedIds.size > 0) {
                params.append('ids', Array.from(selectedIds).join(','));
            } else {
                if (filters.operatorId) params.append('operator_id', filters.operatorId);
                if (filters.hiveCode) params.append('hive_code', filters.hiveCode);
                if (filters.operationTypes.length > 0) params.append('operation_types', filters.operationTypes.join(','));
                if (filters.startTime) params.append('start_time', filters.startTime);
                if (filters.endTime) params.append('end_time', filters.endTime);
            }

            const response = await api.get(`/api/operation-logs/export/csv?${params.toString()}`, {
                responseType: 'blob',
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const disposition = response.headers['content-disposition'];
            const fileName = disposition?.match(/filename=(.+)/)?.[1] || 'operation_logs.csv';
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success('导出成功');
        } catch (error) {
            toast.error('导出失败');
        }
    };

    const toggleOperationType = (value) => {
        const newTypes = filters.operationTypes.includes(value)
            ? filters.operationTypes.filter(t => t !== value)
            : [...filters.operationTypes, value];
        setFilters({ ...filters, operationTypes: newTypes });
    };

    const totalPages = Math.ceil(total / pageSize);

    const formatDateTime = (dt) => {
        if (!dt) return '-';
        const date = new Date(dt);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    const getTypeBadgeClass = (type) => {
        return OPERATION_TYPE_COLORS[type] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    };

    const selectedOperatorName = useMemo(() => {
        if (!filters.operatorId) return '全部养蜂员';
        const op = operators.find(o => o.id === parseInt(filters.operatorId));
        return op ? op.username : '全部养蜂员';
    }, [filters.operatorId, operators]);

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-7xl mx-auto space-y-6">
                <Header />

                <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                    <Link to="/" className="flex items-center gap-1.5 hover:text-white transition-colors">
                        <Home className="w-4 h-4" />
                        <span>首页</span>
                    </Link>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                    <span className="text-white">蜂箱操作日志</span>
                </div>

                <div className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-amber-500/20 rounded-xl">
                                <ScrollText className="w-6 h-6 text-amber-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white">蜂箱操作日志</h1>
                                <p className="text-sm text-slate-400">记录所有蜂箱写操作的完整审计轨迹</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-400">
                            <span className="px-3 py-1.5 rounded-lg bg-slate-800/50">
                                共 <span className="text-white font-medium">{total}</span> 条记录
                            </span>
                            {selectedIds.size > 0 && (
                                <span className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                                    已选 <span className="font-medium">{selectedIds.size}</span> 条
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-900/40 rounded-2xl p-5 mb-6 border border-slate-700/50">
                        <div className="flex items-center gap-2 mb-4">
                            <Filter className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-300">筛选条件</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                            <div className="relative">
                                <label className="text-xs text-slate-400 mb-1.5 block">养蜂员</label>
                                <div className="relative">
                                    <button
                                        onClick={() => { setOperatorDropdownOpen(!operatorDropdownOpen); setTypeDropdownOpen(false); }}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all text-left text-sm flex items-center justify-between text-white"
                                    >
                                        <span className="truncate">{selectedOperatorName}</span>
                                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
                                    </button>
                                    {operatorDropdownOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto">
                                            <div
                                                onClick={() => { setFilters({ ...filters, operatorId: '' }); setOperatorDropdownOpen(false); }}
                                                className="px-4 py-2.5 hover:bg-slate-700/50 cursor-pointer text-sm flex items-center justify-between"
                                            >
                                                <span className="text-slate-300">全部养蜂员</span>
                                                {!filters.operatorId && <Check className="w-4 h-4 text-blue-400" />}
                                            </div>
                                            {operators.map(op => (
                                                <div
                                                    key={op.id}
                                                    onClick={() => { setFilters({ ...filters, operatorId: String(op.id) }); setOperatorDropdownOpen(false); }}
                                                    className="px-4 py-2.5 hover:bg-slate-700/50 cursor-pointer text-sm flex items-center justify-between"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <User className="w-3.5 h-3.5 text-slate-500" />
                                                        <span className="text-slate-200">{op.username}</span>
                                                        <span className="text-xs text-slate-500">({op.role_name})</span>
                                                    </div>
                                                    {filters.operatorId === String(op.id) && <Check className="w-4 h-4 text-blue-400" />}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="relative">
                                <label className="text-xs text-slate-400 mb-1.5 block">操作类型</label>
                                <div className="relative">
                                    <button
                                        onClick={() => { setTypeDropdownOpen(!typeDropdownOpen); setOperatorDropdownOpen(false); }}
                                        className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all text-left text-sm flex items-center justify-between text-white"
                                    >
                                        <span className="truncate">
                                            {filters.operationTypes.length === 0
                                                ? '全部类型'
                                                : `已选 ${filters.operationTypes.length} 种`}
                                        </span>
                                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
                                    </button>
                                    {typeDropdownOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto p-2">
                                            {operationTypes.map(type => (
                                                <div
                                                    key={type.value}
                                                    onClick={() => toggleOperationType(type.value)}
                                                    className="px-3 py-2 hover:bg-slate-700/50 cursor-pointer text-sm rounded-lg flex items-center gap-2"
                                                >
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                                                        filters.operationTypes.includes(type.value)
                                                            ? 'bg-blue-500 border-blue-500'
                                                            : 'border-slate-600'
                                                    }`}>
                                                        {filters.operationTypes.includes(type.value) && (
                                                            <Check className="w-3 h-3 text-white" />
                                                        )}
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded text-xs border ${getTypeBadgeClass(type.value)}`}>
                                                        {type.label}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">蜂箱搜索</label>
                                <div className="relative">
                                    <Box className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="text"
                                        placeholder="输入蜂箱编号..."
                                        value={filters.hiveCode}
                                        onChange={(e) => setFilters({ ...filters, hiveCode: e.target.value })}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-blue-500 outline-none transition-all text-sm text-white placeholder-slate-600"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">开始时间</label>
                                <div className="relative">
                                    <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="datetime-local"
                                        value={filters.startTime}
                                        onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-blue-500 outline-none transition-all text-sm text-white"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">结束时间</label>
                                <div className="relative">
                                    <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="datetime-local"
                                        value={filters.endTime}
                                        onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 focus:border-blue-500 outline-none transition-all text-sm text-white"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-slate-700/50">
                            <button
                                onClick={handleReset}
                                className="px-5 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-all text-sm"
                            >
                                重置
                            </button>
                            <button
                                onClick={handleSearch}
                                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-all text-sm flex items-center gap-2"
                            >
                                <Search className="w-4 h-4" />
                                查询
                            </button>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/30">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wider">
                                    <th className="px-4 py-3.5 font-medium w-12">
                                        <input
                                            type="checkbox"
                                            checked={logs.length > 0 && selectedIds.size === logs.length}
                                            onChange={handleSelectAll}
                                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                                        />
                                    </th>
                                    <th className="px-4 py-3.5 font-medium">操作时间</th>
                                    <th className="px-4 py-3.5 font-medium">操作类型</th>
                                    <th className="px-4 py-3.5 font-medium">操作人</th>
                                    <th className="px-4 py-3.5 font-medium">蜂箱编号</th>
                                    <th className="px-4 py-3.5 font-medium">来源IP</th>
                                    <th className="px-4 py-3.5 font-medium">操作描述</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr>
                                        <td colSpan="7" className="px-6 py-16 text-center">
                                            <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                            <p className="text-slate-500 mt-3 text-sm">加载中...</p>
                                        </td>
                                    </tr>
                                ) : logs.length > 0 ? (
                                    logs.map(log => (
                                        <tr
                                            key={log.id}
                                            onClick={() => handleRowClick(log)}
                                            className={`hover:bg-slate-800/40 transition-colors cursor-pointer ${
                                                selectedIds.has(log.id) ? 'bg-blue-500/5' : ''
                                            }`}
                                        >
                                            <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(log.id)}
                                                    onChange={(e) => handleSelectOne(e, log.id)}
                                                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-2 text-slate-300 text-sm">
                                                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                                                    <span className="font-mono">{formatDateTime(log.created_at)}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${getTypeBadgeClass(log.operation_type)}`}>
                                                    {log.operation_type_name}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                                        <User className="w-3.5 h-3.5 text-white" />
                                                    </div>
                                                    <span className="text-sm text-white">{log.operator_username}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className="text-sm font-mono text-amber-400">{log.hive_code}</span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1.5 text-slate-500 text-xs font-mono">
                                                    <Globe className="w-3 h-3" />
                                                    {log.source_ip || '-'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <p className="text-sm text-slate-400 truncate max-w-xs" title={log.description}>
                                                    {log.description || '-'}
                                                </p>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="7" className="px-6 py-16 text-center">
                                            <ScrollText className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                                            <p className="text-slate-500 text-sm">暂无操作日志</p>
                                            <p className="text-slate-600 text-xs mt-1">对蜂箱的所有写操作都会自动记录在这里</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-700/50">
                        <div className="flex items-center gap-3">
                            <select
                                value={pageSize}
                                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                            >
                                <option value={10}>10 条/页</option>
                                <option value={20}>20 条/页</option>
                                <option value={50}>50 条/页</option>
                                <option value={100}>100 条/页</option>
                            </select>

                            <button
                                onClick={() => handleExport(true)}
                                disabled={selectedIds.size === 0}
                                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-all text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Download className="w-4 h-4" />
                                导出选中
                            </button>

                            <button
                                onClick={() => handleExport(false)}
                                className="px-4 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 transition-all text-sm flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                导出全部
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-400">
                                第 <span className="text-white">{page}</span> / {totalPages || 1} 页
                            </span>
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="w-4 h-4 text-slate-400" />
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {drawerOpen && selectedLog && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setDrawerOpen(false)}
                    />
                    <div className="relative w-full max-w-2xl bg-slate-900 border-l border-slate-700 shadow-2xl overflow-hidden flex flex-col animate-slide-in">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/20 rounded-lg">
                                    <Info className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-white">操作详情</h2>
                                    <p className="text-xs text-slate-400">日志 ID: {selectedLog.id}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">操作类型</p>
                                    <span className={`px-2.5 py-1 rounded-lg text-sm font-medium border ${getTypeBadgeClass(selectedLog.operation_type)}`}>
                                        {selectedLog.operation_type_name}
                                    </span>
                                </div>
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">操作时间</p>
                                    <p className="text-sm text-white font-mono">{formatDateTime(selectedLog.created_at)}</p>
                                </div>
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">操作人</p>
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                            <User className="w-3.5 h-3.5 text-white" />
                                        </div>
                                        <span className="text-sm text-white">{selectedLog.operator_username}</span>
                                        <span className="text-xs text-slate-500">(ID: {selectedLog.operator_id})</span>
                                    </div>
                                </div>
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">目标蜂箱</p>
                                    <div className="flex items-center gap-2">
                                        <Box className="w-4 h-4 text-amber-500" />
                                        <span className="text-sm font-mono text-amber-400">{selectedLog.hive_code}</span>
                                        <span className="text-xs text-slate-500">(ID: {selectedLog.hive_id})</span>
                                    </div>
                                </div>
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">来源 IP</p>
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-4 h-4 text-slate-500" />
                                        <span className="text-sm font-mono text-slate-300">{selectedLog.source_ip || '-'}</span>
                                    </div>
                                </div>
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wider">操作描述</p>
                                    <p className="text-sm text-slate-300">{selectedLog.description || '-'}</p>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-slate-700/50">
                                    <Tag className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm font-medium text-white">操作时关键上下文</span>
                                    <span className="text-xs text-slate-500 ml-auto">JSON 格式</span>
                                </div>
                                <div className="p-4 bg-slate-900/60">
                                    <pre
                                        className="text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed"
                                        dangerouslySetInnerHTML={{ __html: jsonSyntaxHighlight(selectedLog.context_data) }}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-slate-700 bg-slate-800/30">
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors text-sm"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {(operatorDropdownOpen || typeDropdownOpen) && (
                <div
                    className="fixed inset-0 z-10"
                    onClick={() => { setOperatorDropdownOpen(false); setTypeDropdownOpen(false); }}
                />
            )}

            <style>{`
                @keyframes slide-in {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                .animate-slide-in {
                    animation: slide-in 0.3s ease-out;
                }
            `}</style>
        </div>
    );
}

export default BeehiveOperationLog;
