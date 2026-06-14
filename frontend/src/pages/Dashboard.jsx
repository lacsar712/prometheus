import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, hiveApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    BarChart3,
    Clock,
    AlertCircle,
    Plus,
    Database,
    Terminal,
    Server,
    Layout,
    Activity,
    Lock,
    Shield,
    ScrollText,
    ChevronRight,
    Box,
    Image as ImageIcon,
    Thermometer,
    Droplets,
    Scale,
    ChevronLeft,
    MessageCircle,
    CalendarClock,
    ShieldAlert,
    Key,
} from 'lucide-react';
import CommentDrawer from '../components/CommentDrawer';
import { toast } from 'react-toastify';

function Dashboard() {
    const { user, hasPermission, hasRole } = useAuth();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [newItem, setNewItem] = useState({ name: '', description: '' });
    const [lastResponse, setLastResponse] = useState(null);

    const [hives, setHives] = useState([]);
    const [hivesLoading, setHivesLoading] = useState(false);
    const [hivesPage, setHivesPage] = useState(1);
    const [hivesTotal, setHivesTotal] = useState(0);
    const [selectedHive, setSelectedHive] = useState(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const canRead = hasPermission('read');
    const canCreate = hasPermission('create');
    const canUpdate = hasPermission('update');
    const canDelete = hasPermission('delete');
    const canAudit = hasPermission('audit');
    const canManageUsers = hasPermission('manage_users');
    const isFarmOwner = hasRole('farm_owner');
    const isAuditor = hasRole('auditor');

    const fetchItems = async () => {
        if (!canRead) {
            toast.info('您没有查看数据的权限');
            return;
        }
        try {
            const response = await api.get('/api/items');
            setItems(response.data);
        } catch (error) {
            if (error.response?.status !== 403) {
                toast.error('获取列表失败');
            }
        }
    };

    const fetchHives = async () => {
        if (!canRead) return;
        setHivesLoading(true);
        try {
            const response = await hiveApi.list({ page: hivesPage, size: 6 });
            setHives(response.data.items);
            setHivesTotal(response.data.total);
        } catch (error) {
            if (error.response?.status !== 403) {
                toast.error('获取蜂箱列表失败');
            }
        } finally {
            setHivesLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
    }, []);

    useEffect(() => {
        if (canRead) {
            fetchHives();
        }
    }, [hivesPage, canRead]);

    const handleApiCall = async (type) => {
        setLoading(true);
        try {
            let response;
            const startTime = performance.now();

            switch (type) {
                case 'success':
                    response = await api.get('/api/success');
                    toast.success('请求成功');
                    break;
                case 'slow':
                    response = await api.get('/api/slow');
                    toast.info('慢请求完成');
                    break;
                case 'error':
                    response = await api.get('/api/error');
                    break;
                default:
                    break;
            }

            const endTime = performance.now();
            setLastResponse({
                type,
                status: response.status,
                latency: (endTime - startTime).toFixed(0),
                data: response.data
            });
        } catch (error) {
            const endTime = performance.now();
            if (error.response?.status !== 500 || type !== 'error') {
                toast.error(error.response?.data?.detail || '请求失败');
            } else {
                toast.error('模拟故障请求完成');
            }
            setLastResponse({
                type,
                status: error.response?.status || 500,
                latency: (endTime - startTime).toFixed(0),
                data: error.response?.data || 'Unknown error'
            });
        } finally {
            setLoading(false);
        }
    };

    const addItem = async (e) => {
        e.preventDefault();
        if (!canCreate) {
            toast.warning('您没有添加记录的权限');
            return;
        }
        if (!newItem.name || !newItem.description) {
            toast.warning('请填写完整信息');
            return;
        }

        try {
            await api.post(`/api/items?name=${newItem.name}&description=${newItem.description}`);
            toast.success('添加成功');
            setNewItem({ name: '', description: '' });
            fetchItems();
        } catch (error) {
            if (error.response?.status === 403) {
                toast.error('权限不足，无法添加');
            } else {
                toast.error('添加失败');
            }
        }
    };

    return (
        <div className="min-h-screen p-6 md:p-12 text-slate-100">
            <div className="max-w-6xl mx-auto space-y-8">

                <Header />

                {/* 角色权限提示条 */}
                <div className={`rounded-2xl p-4 border flex items-start gap-3 ${
                    isFarmOwner
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : isAuditor
                            ? 'bg-teal-500/10 border-teal-500/30'
                            : 'bg-blue-500/10 border-blue-500/30'
                }`}>
                    <Shield className={`w-5 h-5 shrink-0 mt-0.5 ${
                        isFarmOwner ? 'text-purple-400' : isAuditor ? 'text-teal-400' : 'text-blue-400'
                    }`} />
                    <div className="flex-1">
                        <p className={`text-sm font-medium ${
                            isFarmOwner ? 'text-purple-300' : isAuditor ? 'text-teal-300' : 'text-blue-300'
                        }`}>
                            当前角色：{user?.role_name}（{user?.username}）
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                            可用权限：{user?.permissions?.join('、') || '无'}
                            {canManageUsers && ' · 可管理用户'}
                            {!canCreate && ' · 仅可查看'}
                        </p>
                    </div>
                </div>

                {/* 功能入口 */}
                <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-5">
                        <Layout className="w-5 h-5 text-amber-400" />
                        <h2 className="text-xl font-semibold text-white">功能入口</h2>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {(canAudit || canRead) && (
                            <Link
                                to="/operation-logs"
                                className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-800/50 hover:bg-amber-500/10 border border-slate-700 hover:border-amber-500/30 transition-all"
                            >
                                <div className="p-3 bg-amber-500/20 rounded-xl group-hover:scale-110 transition-transform">
                                    <ScrollText className="w-6 h-6 text-amber-400" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-white">蜂箱操作日志</p>
                                    <p className="text-xs text-slate-500 mt-1">审计追踪 · 操作留痕</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-amber-400 transition-colors" />
                            </Link>
                        )}
                        {canRead && (
                            <Link
                                to="/hives/1"
                                className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-800/50 hover:bg-blue-500/10 border border-slate-700 hover:border-blue-500/30 transition-all"
                            >
                                <div className="p-3 bg-blue-500/20 rounded-xl group-hover:scale-110 transition-transform">
                                    <ImageIcon className="w-6 h-6 text-blue-400" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-white">照片墙演示</p>
                                    <p className="text-xs text-slate-500 mt-1">蜂群照片 · 巡检附件</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 transition-colors" />
                            </Link>
                        )}
                        {canRead && (
                            <Link
                                to="/inspection-plans"
                                className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-800/50 hover:bg-violet-500/10 border border-slate-700 hover:border-violet-500/30 transition-all"
                            >
                                <div className="p-3 bg-violet-500/20 rounded-xl group-hover:scale-110 transition-transform">
                                    <CalendarClock className="w-6 h-6 text-violet-400" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-white">巡检计划</p>
                                    <p className="text-xs text-slate-500 mt-1">季节调度 · 自动工单</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 transition-colors" />
                            </Link>
                        )}
                        {canRead && (
                            <Link
                                to="/sensor-flow-control"
                                className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-800/50 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 transition-all"
                            >
                                <div className="p-3 bg-rose-500/20 rounded-xl group-hover:scale-110 transition-transform">
                                    <ShieldAlert className="w-6 h-6 text-rose-400" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-white">传感器流控</p>
                                    <p className="text-xs text-slate-500 mt-1">令牌限流 · 设备封禁</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-rose-400 transition-colors" />
                            </Link>
                        )}
                        {canRead && (
                            <Link
                                to="/api-keys"
                                className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-800/50 hover:bg-indigo-500/10 border border-slate-700 hover:border-indigo-500/30 transition-all"
                            >
                                <div className="p-3 bg-indigo-500/20 rounded-xl group-hover:scale-110 transition-transform">
                                    <Key className="w-6 h-6 text-indigo-400" />
                                </div>
                                <div className="text-center">
                                    <p className="font-medium text-white">API Keys</p>
                                    <p className="text-xs text-slate-500 mt-1">设备凭证 · SaaS 接入</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                            </Link>
                        )}
                    </div>
                </section>

                {/* 蜂箱列表 */}
                {canRead && (
                    <section className="glass-card rounded-3xl p-6">
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                            <Box className="w-5 h-5 text-emerald-400" />
                            <h2 className="text-xl font-semibold text-white">蜂箱档案</h2>
                        </div>
                        <span className="text-sm text-slate-400">
                            共 <span className="text-white font-medium">{hivesTotal}</span> 个蜂箱
                        </span>
                    </div>

                    {hivesLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : hives.length > 0 ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {hives.map((hive) => (
                                    <Link
                                        key={hive.id}
                                        to={`/hives/${hive.id}`}
                                        className="group p-4 rounded-2xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/30 transition-all"
                                    >
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                            <div className="p-2 bg-amber-500/20 rounded-lg">
                                                <Box className="w-5 h-5 text-amber-400" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-white">{hive.hive_code}</p>
                                                <p className="text-xs text-slate-500">{hive.apiary_id}</p>
                                            </div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                            hive.status === 'active'
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-slate-500/20 text-slate-400'
                                        }`}>
                                            {hive.status === 'active' ? '运行中' : '已退役'}
                                        </span>
                                    </div>

                                        <div className="grid grid-cols-3 gap-2 text-center">
                                            <div className="bg-slate-700/30 rounded-lg p-2">
                                                <Thermometer className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                                                <p className="text-sm font-medium text-white">
                                                    {hive.temperature !== null && hive.temperature !== undefined
                                                        ? `${hive.temperature}℃`
                                                        : '-'}
                                                </p>
                                                <p className="text-xs text-slate-500">温度</p>
                                            </div>
                                            <div className="bg-slate-700/30 rounded-lg p-2">
                                                <Droplets className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                                                <p className="text-sm font-medium text-white">
                                                    {hive.humidity !== null && hive.humidity !== undefined
                                                        ? `${hive.humidity}%`
                                                        : '-'}
                                                </p>
                                                <p className="text-xs text-slate-500">湿度</p>
                                            </div>
                                            <div className="bg-slate-700/30 rounded-lg p-2">
                                                <Scale className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                                                <p className="text-sm font-medium text-white">
                                                    {hive.weight !== null && hive.weight !== undefined
                                                        ? `${hive.weight}kg`
                                                        : '-'}
                                                </p>
                                                <p className="text-xs text-slate-500">重量</p>
                                            </div>
                                        </div>

                                        <div className="mt-3 pt-3 border-t border-slate-700/50 flex items-center justify-between">
                                            <span className="text-xs text-slate-500">
                                                {hive.strength_level_name || '-'}群势
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setSelectedHive(hive);
                                                        setDrawerOpen(true);
                                                    }}
                                                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs"
                                                >
                                                    <MessageCircle className="w-3.5 h-3.5" />
                                                    <span>蜂友讨论</span>
                                                </button>
                                                <span className="text-xs text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1">
                                                    查看详情
                                                    <ChevronRight className="w-3 h-3" />
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>

                            {hivesTotal > 6 && (
                                <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-slate-700/50">
                                    <button
                                        onClick={() => setHivesPage((p) => Math.max(1, p - 1))}
                                        disabled={hivesPage <= 1}
                                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="w-4 h-4 text-slate-400" />
                                    </button>
                                    <span className="text-sm text-slate-400">
                                        第 <span className="text-white">{hivesPage}</span> 页
                                    </span>
                                    <button
                                        onClick={() => setHivesPage((p) => p + 1)}
                                        disabled={hivesPage * 6 >= hivesTotal}
                                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <ChevronRight className="w-4 h-4 text-slate-400" />
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Box className="w-12 h-12 text-slate-600 mb-3" />
                            <p className="text-slate-400">暂无蜂箱数据</p>
                            <p className="text-xs text-slate-600 mt-1">系统初始化后将显示蜂箱列表</p>
                        </div>
                    )}
                </section>
            )}

                {/* Dash Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* API Playground */}
                    <section className="md:col-span-2 glass-card rounded-3xl p-6 space-y-6">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-blue-400" />
                                <h2 className="text-xl font-semibold text-white">请求模拟器 (Trigger Metrics)</h2>
                            </div>
                            {canAudit && (
                                <span className="px-2.5 py-1 rounded-md bg-teal-500/15 text-teal-400 text-xs font-medium flex items-center gap-1">
                                    <Lock className="w-3 h-3" />
                                    审计模式
                                </span>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {(canRead || canCreate) && (
                                <button
                                    onClick={() => handleApiCall('success')}
                                    disabled={loading}
                                    className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-green-500/10 border border-slate-700 hover:border-green-500/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="p-2 bg-green-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                        <Activity className="w-6 h-6 text-green-400" />
                                    </div>
                                    <span className="font-medium text-green-400">成功请求</span>
                                    <span className="text-xs text-slate-500">HTTP 200</span>
                                </button>
                            )}

                            {canUpdate && (
                                <button
                                    onClick={() => handleApiCall('slow')}
                                    disabled={loading}
                                    className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-yellow-500/10 border border-slate-700 hover:border-yellow-500/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="p-2 bg-yellow-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                        <Clock className="w-6 h-6 text-yellow-400" />
                                    </div>
                                    <span className="font-medium text-yellow-400">延迟请求</span>
                                    <span className="text-xs text-slate-500">Delay 1-2s</span>
                                </button>
                            )}

                            {(canAudit || canDelete) && (
                                <button
                                    onClick={() => handleApiCall('error')}
                                    disabled={loading}
                                    className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl bg-slate-800/50 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <div className="p-2 bg-red-500/20 rounded-lg group-hover:scale-110 transition-transform">
                                        <AlertCircle className="w-6 h-6 text-red-400" />
                                    </div>
                                    <span className="font-medium text-red-400">错误请求</span>
                                    <span className="text-xs text-slate-500">HTTP 500</span>
                                </button>
                            )}

                            {!(canRead || canCreate) && (
                                <div className="sm:col-span-3 p-6 rounded-2xl bg-slate-800/30 border border-slate-700 text-center">
                                    <Lock className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                                    <p className="text-slate-400 text-sm">当前角色无权执行操作</p>
                                </div>
                            )}
                        </div>

                        {/* Last Response Info */}
                        <div className="rounded-2xl bg-slate-900/50 border border-slate-800 p-4 font-mono text-sm">
                            <div className="flex items-center gap-2 mb-2 text-slate-500">
                                <Terminal className="w-4 h-4" />
                                <span>Last Response</span>
                            </div>
                            {lastResponse ? (
                                <div className="space-y-1">
                                    <p><span className="text-blue-400">Status:</span> {lastResponse.status}</p>
                                    <p><span className="text-blue-400">Latency:</span> {lastResponse.latency}ms</p>
                                    <pre className="text-slate-400 overflow-x-auto text-xs mt-2">
                                        {JSON.stringify(lastResponse.data, null, 2)}
                                    </pre>
                                </div>
                            ) : (
                                <p className="text-slate-600 italic">等待操作...</p>
                            )}
                        </div>
                    </section>

                    {/* Monitoring Intro */}
                    <section className="glass-card rounded-3xl p-6 flex flex-col justify-between space-y-4">
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <Server className="w-5 h-5 text-purple-400" />
                                <h2 className="text-xl font-semibold text-white">指标说明</h2>
                            </div>
                            <ul className="space-y-4 text-sm text-slate-400">
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-blue-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">QPS (Queries Per Second)</strong>
                                        统计每秒请求数。Prometheus 通过 counter 指标 `http_requests_total` 计算获得。
                                    </div>
                                </li>
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-yellow-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">P99 Latency (耗时)</strong>
                                        表示 99% 的请求都在此耗时内。通过 histogram 指标 `http_request_duration_seconds_bucket` 计算。
                                    </div>
                                </li>
                                <li className="flex gap-3">
                                    <div className="mt-1 w-1.5 h-1.5 bg-red-500 rounded-full shrink-0"></div>
                                    <div>
                                        <strong className="text-slate-200 block mb-1">Error Rate (错误率)</strong>
                                        统计非 2xx/3xx 响应的占比。
                                    </div>
                                </li>
                            </ul>
                        </div>
                        <a
                            href="http://localhost:9090"
                            target="_blank"
                            rel="noreferrer"
                            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-center font-medium transition-colors flex items-center justify-center gap-2 text-white"
                        >
                            <Layout className="w-4 h-4" />
                            查看 Prometheus 面板
                        </a>
                    </section>

                    {/* Database Demo */}
                    <section className="md:col-span-3 glass-card rounded-3xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <Database className="w-5 h-5 text-emerald-400" />
                                <h2 className="text-xl font-semibold text-white">数据库读写测试</h2>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                {canRead && <span className="px-2 py-1 rounded bg-slate-800">可读</span>}
                                {canCreate && <span className="px-2 py-1 rounded bg-slate-800">可写</span>}
                                {canUpdate && <span className="px-2 py-1 rounded bg-slate-800">可改</span>}
                                {canDelete && <span className="px-2 py-1 rounded bg-slate-800">可删</span>}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Form */}
                            <div className="lg:col-span-1 space-y-4">
                                {canCreate ? (
                                    <form onSubmit={addItem} className="space-y-4">
                                        <input
                                            type="text"
                                            placeholder="名称"
                                            value={newItem.name}
                                            onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition-all text-white placeholder-slate-600"
                                        />
                                        <textarea
                                            placeholder="描述"
                                            value={newItem.description}
                                            onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition-all h-24 text-white placeholder-slate-600"
                                        />
                                        <button
                                            type="submit"
                                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors text-white"
                                        >
                                            <Plus className="w-4 h-4" />
                                            添加记录
                                        </button>
                                    </form>
                                ) : (
                                    <div className="rounded-2xl bg-slate-900/30 border border-slate-800 p-6 text-center">
                                        <Lock className="w-8 h-8 text-slate-500 mx-auto mb-3" />
                                        <p className="text-slate-400 text-sm">当前角色没有写入权限</p>
                                        <p className="text-slate-600 text-xs mt-1">如需添加数据，请联系场主或管理员</p>
                                    </div>
                                )}
                            </div>

                            {/* Table */}
                            <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-800/50 text-slate-400 text-sm">
                                            <th className="px-6 py-4 font-medium">ID</th>
                                            <th className="px-6 py-4 font-medium">名称</th>
                                            <th className="px-6 py-4 font-medium">描述</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {canRead ? (
                                            items.length > 0 ? items.map(item => (
                                                <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                                                    <td className="px-6 py-4 text-slate-500">{item.id}</td>
                                                    <td className="px-6 py-4 font-medium text-white">{item.name}</td>
                                                    <td className="px-6 py-4 text-slate-400">{item.description}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="3" className="px-6 py-12 text-center text-slate-600 italic">暂无数据</td>
                                                </tr>
                                            )
                                        ) : (
                                            <tr>
                                                <td colSpan="3" className="px-6 py-12 text-center">
                                                    <Lock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                                                    <p className="text-slate-600 italic">无权查看数据</p>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <footer className="text-center text-slate-500 text-sm py-8 border-t border-slate-800">
                    <p>© 2024 Prometheus Monitoring Fullstack Demo. Powered by FastAPI & React.</p>
                </footer>
            </div>

            <CommentDrawer
                hive={selectedHive}
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
            />
        </div>
    );
}

export default Dashboard;
