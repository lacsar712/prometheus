import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { hiveApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import PhotoWall from '../components/PhotoWall';
import {
    Box,
    ChevronLeft,
    Home,
    ChevronRight,
    Thermometer,
    Droplets,
    Scale,
    MapPin,
    Calendar,
    User,
    Tag,
    Activity,
    ScrollText,
    Image as ImageIcon,
    Info,
    Loader2,
} from 'lucide-react';
import { toast } from 'react-toastify';

const TABS = [
    { id: 'info', label: '基本信息', icon: Info },
    { id: 'photos', label: '照片墙', icon: ImageIcon },
];

function formatDateTime(dt) {
    if (!dt) return '-';
    const date = new Date(dt);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

const STRENGTH_LEVEL_NAMES = {
    weak: '弱',
    medium: '中',
    strong: '强',
    very_strong: '特强',
};

const STRENGTH_COLORS = {
    weak: 'bg-red-500/20 text-red-400 border-red-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    strong: 'bg-green-500/20 text-green-400 border-green-500/30',
    very_strong: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const STATUS_NAMES = {
    active: '运行中',
    retired: '已退役',
};

const STATUS_COLORS = {
    active: 'bg-green-500/20 text-green-400',
    retired: 'bg-slate-500/20 text-slate-400',
};

function BeehiveDetail() {
    const { id } = useParams();
    const { user } = useAuth();
    const [hive, setHive] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('photos');

    useEffect(() => {
        if (id) {
            fetchHive();
        }
    }, [id]);

    const fetchHive = async () => {
        setLoading(true);
        try {
            const response = await hiveApi.get(id);
            setHive(response.data);
        } catch (error) {
            if (error.response?.status !== 403) {
                toast.error('获取蜂箱详情失败');
            }
        } finally {
            setLoading(false);
        }
    };

    const getStrengthBadge = (level) => {
        const colorClass = STRENGTH_COLORS[level] || 'bg-slate-500/20 text-slate-400';
        const name = STRENGTH_LEVEL_NAMES[level] || level;
        return (
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${colorClass}`}>
                {name}
            </span>
        );
    };

    const getStatusBadge = (status) => {
        const colorClass = STATUS_COLORS[status] || 'bg-slate-500/20 text-slate-400';
        const name = STATUS_NAMES[status] || status;
        return (
            <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${colorClass}`}>
                {name}
            </span>
        );
    };

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
                    <Link to="/" className="flex items-center gap-1.5 hover:text-white transition-colors">
                        <Box className="w-4 h-4" />
                        <span>蜂箱管理</span>
                    </Link>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                    <span className="text-white truncate max-w-xs">
                        {loading ? '加载中...' : hive?.hive_code || '蜂箱详情'}
                    </span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : hive ? (
                    <>
                        <div className="glass-card rounded-3xl p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-amber-500/20 rounded-2xl">
                                        <Box className="w-8 h-8 text-amber-400" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <h1 className="text-2xl font-bold text-white">
                                                {hive.hive_code}
                                            </h1>
                                            {getStatusBadge(hive.status)}
                                            {getStrengthBadge(hive.strength_level)}
                                        </div>
                                        <p className="text-sm text-slate-400 mt-1">
                                            蜂场: {hive.apiary_id}
                                            {hive.bee_species && ` · 蜂种: ${hive.bee_species}`}
                                            {hive.box_type && ` · 箱型: ${hive.box_type}`}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                                        <Thermometer className="w-4 h-4" />
                                        <span>箱内温度</span>
                                    </div>
                                    <p className="text-2xl font-bold text-white">
                                        {hive.temperature !== null && hive.temperature !== undefined
                                            ? `${hive.temperature}℃`
                                            : '-'}
                                    </p>
                                </div>

                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                                        <Droplets className="w-4 h-4" />
                                        <span>箱内湿度</span>
                                    </div>
                                    <p className="text-2xl font-bold text-white">
                                        {hive.humidity !== null && hive.humidity !== undefined
                                            ? `${hive.humidity}%`
                                            : '-'}
                                    </p>
                                </div>

                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                                        <Scale className="w-4 h-4" />
                                        <span>蜂箱重量</span>
                                    </div>
                                    <p className="text-2xl font-bold text-white">
                                        {hive.weight !== null && hive.weight !== undefined
                                            ? `${hive.weight} kg`
                                            : '-'}
                                    </p>
                                </div>

                                <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                    <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
                                        <Calendar className="w-4 h-4" />
                                        <span>最近巡检</span>
                                    </div>
                                    <p className="text-sm font-medium text-white">
                                        {formatDate(hive.last_inspected_at)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="glass-card rounded-3xl overflow-hidden">
                            <div className="flex items-center gap-1 px-4 py-3 border-b border-slate-700/50 bg-slate-800/30">
                                {TABS.map((tab) => {
                                    const Icon = tab.icon;
                                    const isActive = activeTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                                                isActive
                                                    ? 'bg-blue-600/20 text-blue-400'
                                                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                                            }`}
                                        >
                                            <Icon className="w-4 h-4" />
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="p-6">
                                {activeTab === 'info' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                                <Tag className="w-5 h-5 text-amber-400" />
                                                基本信息
                                            </h3>
                                            <div className="space-y-3">
                                                <InfoRow label="蜂箱编号" value={hive.hive_code} />
                                                <InfoRow label="所属蜂场" value={hive.apiary_id} />
                                                <InfoRow label="蜂种" value={hive.bee_species} />
                                                <InfoRow label="箱型" value={hive.box_type} />
                                                <InfoRow
                                                    label="群势等级"
                                                    value={
                                                        <span>
                                                            {STRENGTH_LEVEL_NAMES[hive.strength_level] ||
                                                                hive.strength_level}
                                                        </span>
                                                    }
                                                />
                                                <InfoRow label="状态" value={STATUS_NAMES[hive.status] || hive.status} />
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                                <Activity className="w-5 h-5 text-green-400" />
                                                环境数据
                                            </h3>
                                            <div className="space-y-3">
                                                <InfoRow
                                                    label="箱内温度"
                                                    value={
                                                        hive.temperature !== null &&
                                                        hive.temperature !== undefined
                                                            ? `${hive.temperature} ℃`
                                                            : '-'
                                                    }
                                                />
                                                <InfoRow
                                                    label="箱内湿度"
                                                    value={
                                                        hive.humidity !== null && hive.humidity !== undefined
                                                            ? `${hive.humidity} %`
                                                            : '-'
                                                    }
                                                />
                                                <InfoRow
                                                    label="蜂箱重量"
                                                    value={
                                                        hive.weight !== null && hive.weight !== undefined
                                                            ? `${hive.weight} kg`
                                                            : '-'
                                                    }
                                                />
                                                <InfoRow
                                                    label="位置坐标"
                                                    value={
                                                        hive.location_lat && hive.location_lng
                                                            ? `${hive.location_lat.toFixed(4)}, ${hive.location_lng.toFixed(4)}`
                                                            : '-'
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                                <Calendar className="w-5 h-5 text-blue-400" />
                                                时间信息
                                            </h3>
                                            <div className="space-y-3">
                                                <InfoRow label="创建时间" value={formatDateTime(hive.created_at)} />
                                                <InfoRow
                                                    label="蜂王出生日期"
                                                    value={formatDate(hive.queen_birth_date)}
                                                />
                                                <InfoRow
                                                    label="最近巡检时间"
                                                    value={formatDateTime(hive.last_inspected_at)}
                                                />
                                                {hive.status === 'retired' && (
                                                    <InfoRow
                                                        label="退役时间"
                                                        value={formatDateTime(hive.retired_at)}
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                                <ScrollText className="w-5 h-5 text-purple-400" />
                                                备注
                                            </h3>
                                            <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50 min-h-[100px]">
                                                <p className="text-slate-300 text-sm whitespace-pre-wrap">
                                                    {hive.notes || '暂无备注'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'photos' && (
                                    <PhotoWall hiveId={hive.id} hiveCode={hive.hive_code} />
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Box className="w-16 h-16 text-slate-600 mb-4" />
                        <p className="text-slate-400">蜂箱不存在</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function InfoRow({ label, value }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-b-0">
            <span className="text-sm text-slate-400">{label}</span>
            <span className="text-sm text-white font-medium">{value}</span>
        </div>
    );
}

export default BeehiveDetail;
