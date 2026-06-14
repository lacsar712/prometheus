import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    nectarCalendarApi,
    relocationPlanApi,
    relocationApi,
    hiveApi,
} from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import {
    Map,
    Flower2,
    Plus,
    X,
    Calendar,
    MapPin,
    Truck,
    Users,
    Clock,
    Download,
    Check,
    ChevronRight,
    Loader2,
    Play,
    CheckCircle,
    XCircle,
    ZoomIn,
    ZoomOut,
    Move,
    Box,
    Crown,
    Layers,
    ListChecks,
    Navigation,
} from 'lucide-react';
import { toast } from 'react-toastify';

const STATUS_COLORS = {
    planned: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    in_transit: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    cancelled: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const STRENGTH_LEVEL_NAMES = {
    weak: '弱',
    medium: '中',
    strong: '强',
    very_strong: '特强',
};

const QUEEN_STATUS_OPTIONS = [
    { value: 'normal', label: '正常' },
    { value: 'weak', label: '偏弱' },
    { value: 'queenless', label: '失王' },
];

const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
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

function RelocationMap() {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const canRead = hasPermission('read');
    const canCreate = hasPermission('create');
    const canUpdate = hasPermission('update');
    const canDelete = hasPermission('delete');

    const [nectarCalendars, setNectarCalendars] = useState([]);
    const [plantTypes, setPlantTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedNectar, setSelectedNectar] = useState(null);
    const [showNectarModal, setShowNectarModal] = useState(false);
    const [editingNectar, setEditingNectar] = useState(null);
    const [nectarFormData, setNectarFormData] = useState({
        plant_type: 'rape',
        plant_name: '',
        location_name: '',
        location_lat: 30.0,
        location_lng: 110.0,
        bloom_start_date: '',
        bloom_end_date: '',
        max_hive_capacity: 100,
        nectar_quality: '',
        notes: '',
    });
    const [nectarSubmitting, setNectarSubmitting] = useState(false);

    const [relocationPlans, setRelocationPlans] = useState([]);
    const [plansLoading, setPlansLoading] = useState(false);
    const [showPlanModal, setShowPlanModal] = useState(false);
    const [editingPlan, setEditingPlan] = useState(null);
    const [planFormData, setPlanFormData] = useState({
        plan_name: '',
        source_apiary_id: 'default',
        source_location_name: '',
        source_lat: 30.0,
        source_lng: 110.0,
        destination_apiary_id: '',
        destination_location_name: '',
        destination_lat: 31.0,
        destination_lng: 111.0,
        departure_date: '',
        transport_vehicle: '',
        beekeepers: [],
        hive_list: [],
        notes: '',
    });
    const [planSubmitting, setPlanSubmitting] = useState(false);
    const [distanceEstimate, setDistanceEstimate] = useState(null);
    const [estimatingDistance, setEstimatingDistance] = useState(false);

    const [hives, setHives] = useState([]);
    const [hivesLoading, setHivesLoading] = useState(false);
    const [showHiveSelector, setShowHiveSelector] = useState(false);

    const [showChecklistModal, setShowChecklistModal] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState(null);
    const [checklistItems, setChecklistItems] = useState([]);

    const [activeTab, setActiveTab] = useState('map');

    const [mapView, setMapView] = useState({
        centerX: 400,
        centerY: 300,
        scale: 1,
    });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const svgRef = useRef(null);

    const [isPickingDestination, setIsPickingDestination] = useState(false);
    const [isPickingSource, setIsPickingSource] = useState(false);

    const fetchNectarCalendars = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        try {
            const now = new Date();
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 60);

            const res = await nectarCalendarApi.list({
                page: 1,
                size: 100,
                start_date: now.toISOString(),
                end_date: endDate.toISOString(),
            });
            setNectarCalendars(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取花期日历失败');
        } finally {
            setLoading(false);
        }
    }, [canRead]);

    const fetchPlantTypes = useCallback(async () => {
        try {
            const res = await nectarCalendarApi.getPlantTypes();
            setPlantTypes(res.data.plant_types || []);
        } catch (_) {}
    }, []);

    const fetchRelocationPlans = useCallback(async () => {
        if (!canRead) return;
        setPlansLoading(true);
        try {
            const res = await relocationPlanApi.list({ page: 1, size: 50 });
            setRelocationPlans(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取转场计划失败');
        } finally {
            setPlansLoading(false);
        }
    }, [canRead]);

    const fetchHives = useCallback(async () => {
        if (!canRead) return;
        setHivesLoading(true);
        try {
            const res = await hiveApi.list({ page: 1, size: 100 });
            setHives(res.data.items || []);
        } catch (err) {
            if (err.response?.status !== 403) toast.error('获取蜂箱列表失败');
        } finally {
            setHivesLoading(false);
        }
    }, [canRead]);

    useEffect(() => {
        if (canRead) {
            fetchNectarCalendars();
            fetchPlantTypes();
            fetchRelocationPlans();
            fetchHives();
        }
    }, [fetchNectarCalendars, fetchPlantTypes, fetchRelocationPlans, fetchHives, canRead]);

    const estimateDistance = useCallback(async () => {
        if (!planFormData.source_lat || !planFormData.source_lng ||
            !planFormData.destination_lat || !planFormData.destination_lng) {
            return;
        }
        setEstimatingDistance(true);
        try {
            const res = await relocationApi.estimateDistance({
                source_lat: planFormData.source_lat,
                source_lng: planFormData.source_lng,
                destination_lat: planFormData.destination_lat,
                destination_lng: planFormData.destination_lng,
                departure_time: planFormData.departure_date || undefined,
            });
            setDistanceEstimate(res.data);
        } catch (err) {
            toast.error('距离估算失败');
        } finally {
            setEstimatingDistance(false);
        }
    }, [planFormData.source_lat, planFormData.source_lng, planFormData.destination_lat, planFormData.destination_lng, planFormData.departure_date]);

    useEffect(() => {
        if (showPlanModal) {
            estimateDistance();
        }
    }, [showPlanModal, estimateDistance]);

    const latLngToSvg = (lat, lng) => {
        const mapLatMin = 18;
        const mapLatMax = 54;
        const mapLngMin = 73;
        const mapLngMax = 135;
        const svgWidth = 800;
        const svgHeight = 600;

        const x = ((lng - mapLngMin) / (mapLngMax - mapLngMin)) * svgWidth;
        const y = ((mapLatMax - lat) / (mapLatMax - mapLatMin)) * svgHeight;

        return { x, y };
    };

    const svgToLatLng = (x, y) => {
        const mapLatMin = 18;
        const mapLatMax = 54;
        const mapLngMin = 73;
        const mapLngMax = 135;
        const svgWidth = 800;
        const svgHeight = 600;

        const lng = (x / svgWidth) * (mapLngMax - mapLngMin) + mapLngMin;
        const lat = mapLatMax - (y / svgHeight) * (mapLatMax - mapLatMin);

        return { lat, lng };
    };

    const handleSvgMouseDown = (e) => {
        if (isPickingSource || isPickingDestination) return;
        setIsDragging(true);
        setDragStart({
            x: e.clientX - mapView.centerX,
            y: e.clientY - mapView.centerY,
        });
    };

    const handleSvgMouseMove = (e) => {
        if (!isDragging) return;
        setMapView((prev) => ({
            ...prev,
            centerX: e.clientX - dragStart.x,
            centerY: e.clientY - dragStart.y,
        }));
    };

    const handleSvgMouseUp = () => {
        setIsDragging(false);
    };

    const handleMapClick = (e) => {
        if (!isPickingSource && !isPickingDestination) return;

        const svg = svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        const x = (e.clientX - rect.left - mapView.centerX) / mapView.scale + 400;
        const y = (e.clientY - rect.top - mapView.centerY) / mapView.scale + 300;

        const { lat, lng } = svgToLatLng(x, y);
        const roundedLat = Math.round(lat * 10000) / 10000;
        const roundedLng = Math.round(lng * 10000) / 10000;

        if (isPickingSource) {
            setPlanFormData((prev) => ({
                ...prev,
                source_lat: roundedLat,
                source_lng: roundedLng,
                source_location_name: `选点 (${roundedLat.toFixed(4)}, ${roundedLng.toFixed(4)})`,
            }));
            setIsPickingSource(false);
            toast.info('已选择出发地');
        }
        if (isPickingDestination) {
            setPlanFormData((prev) => ({
                ...prev,
                destination_lat: roundedLat,
                destination_lng: roundedLng,
                destination_location_name: `选点 (${roundedLat.toFixed(4)}, ${roundedLng.toFixed(4)})`,
            }));
            setIsPickingDestination(false);
            toast.info('已选择目的地');
        }
    };

    const handleZoom = (factor) => {
        setMapView((prev) => ({
            ...prev,
            scale: Math.max(0.5, Math.min(3, prev.scale * factor)),
        }));
    };

    const handleNectarClick = (nectar) => {
        setSelectedNectar(nectar);
    };

    const openNectarModal = (nectar = null) => {
        if (nectar) {
            setEditingNectar(nectar);
            setNectarFormData({
                plant_type: nectar.plant_type,
                plant_name: nectar.plant_name,
                location_name: nectar.location_name,
                location_lat: nectar.location_lat,
                location_lng: nectar.location_lng,
                bloom_start_date: new Date(nectar.bloom_start_date).toISOString().slice(0, 16),
                bloom_end_date: new Date(nectar.bloom_end_date).toISOString().slice(0, 16),
                max_hive_capacity: nectar.max_hive_capacity,
                nectar_quality: nectar.nectar_quality || '',
                notes: nectar.notes || '',
            });
        } else {
            setEditingNectar(null);
            const now = new Date();
            const start = new Date();
            start.setDate(start.getDate() + 30);
            const end = new Date();
            end.setDate(end.getDate() + 60);
            setNectarFormData({
                plant_type: 'rape',
                plant_name: '',
                location_name: '',
                location_lat: 30.0,
                location_lng: 110.0,
                bloom_start_date: start.toISOString().slice(0, 16),
                bloom_end_date: end.toISOString().slice(0, 16),
                max_hive_capacity: 100,
                nectar_quality: '',
                notes: '',
            });
        }
        setShowNectarModal(true);
    };

    const handleNectarSubmit = async (e) => {
        e.preventDefault();
        if (!canCreate && !editingNectar) return;
        setNectarSubmitting(true);
        try {
            if (editingNectar) {
                await nectarCalendarApi.update(editingNectar.id, nectarFormData);
                toast.success('花期日历已更新');
            } else {
                await nectarCalendarApi.create(nectarFormData);
                toast.success('花期日历已创建');
            }
            setShowNectarModal(false);
            fetchNectarCalendars();
        } catch (err) {
            toast.error(err.response?.data?.detail || '保存失败');
        } finally {
            setNectarSubmitting(false);
        }
    };

    const handleDeleteNectar = async (id) => {
        if (!canDelete) return;
        if (!window.confirm('确定要删除这个花期日历吗？')) return;
        try {
            await nectarCalendarApi.remove(id);
            toast.success('已删除');
            setShowNectarModal(false);
            setSelectedNectar(null);
            fetchNectarCalendars();
        } catch (err) {
            toast.error('删除失败');
        }
    };

    const openPlanModal = (plan = null) => {
        if (plan) {
            setEditingPlan(plan);
            setPlanFormData({
                plan_name: plan.plan_name,
                source_apiary_id: plan.source_apiary_id,
                source_location_name: plan.source_location_name,
                source_lat: plan.source_lat,
                source_lng: plan.source_lng,
                destination_apiary_id: plan.destination_apiary_id,
                destination_location_name: plan.destination_location_name,
                destination_lat: plan.destination_lat,
                destination_lng: plan.destination_lng,
                departure_date: new Date(plan.departure_date).toISOString().slice(0, 16),
                transport_vehicle: plan.transport_vehicle || '',
                beekeepers: plan.beekeepers || [],
                hive_list: plan.hive_list || [],
                notes: plan.notes || '',
            });
            setChecklistItems(plan.hive_list || []);
        } else {
            setEditingPlan(null);
            const now = new Date();
            now.setDate(now.getDate() + 3);
            setPlanFormData({
                plan_name: '',
                source_apiary_id: 'default',
                source_location_name: '',
                source_lat: 30.0,
                source_lng: 110.0,
                destination_apiary_id: '',
                destination_location_name: '',
                destination_lat: 31.0,
                destination_lng: 111.0,
                departure_date: now.toISOString().slice(0, 16),
                transport_vehicle: '',
                beekeepers: [],
                hive_list: [],
                notes: '',
            });
            setChecklistItems([]);
        }
        setDistanceEstimate(null);
        setShowPlanModal(true);
    };

    const handlePlanSubmit = async (e) => {
        e.preventDefault();
        if (!canCreate && !editingPlan) return;
        setPlanSubmitting(true);
        try {
            const submitData = {
                ...planFormData,
                hive_list: checklistItems,
            };
            if (editingPlan) {
                await relocationPlanApi.update(editingPlan.id, submitData);
                toast.success('转场计划已更新');
            } else {
                await relocationPlanApi.create(submitData);
                toast.success('转场计划已创建');
            }
            setShowPlanModal(false);
            fetchRelocationPlans();
        } catch (err) {
            toast.error(err.response?.data?.detail || '保存失败');
        } finally {
            setPlanSubmitting(false);
        }
    };

    const handleStartRelocation = async (planId) => {
        if (!canUpdate) return;
        try {
            await relocationPlanApi.start(planId);
            toast.success('转场已开始');
            fetchRelocationPlans();
        } catch (err) {
            toast.error(err.response?.data?.detail || '操作失败');
        }
    };

    const handleCompleteRelocation = async (planId) => {
        if (!canUpdate) return;
        if (!window.confirm('确定要完成转场吗？这将批量更新所有蜂箱的所属蜂场。')) return;
        try {
            await relocationPlanApi.complete(planId);
            toast.success('转场已完成，蜂箱归属已更新');
            fetchRelocationPlans();
        } catch (err) {
            toast.error(err.response?.data?.detail || '操作失败');
        }
    };

    const handleCancelRelocation = async (planId) => {
        if (!canUpdate) return;
        if (!window.confirm('确定要取消这个转场计划吗？')) return;
        try {
            await relocationPlanApi.cancel(planId);
            toast.success('转场已取消');
            fetchRelocationPlans();
        } catch (err) {
            toast.error(err.response?.data?.detail || '操作失败');
        }
    };

    const handleExportChecklist = async (planId) => {
        try {
            const res = await relocationPlanApi.exportChecklist(planId);
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `转场清单_${planId}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            toast.error('导出失败');
        }
    };

    const addHiveToChecklist = (hive) => {
        if (checklistItems.find((item) => item.hive_id === hive.id)) {
            toast.warning('该蜂箱已在清单中');
            return;
        }
        const newItem = {
            hive_id: hive.id,
            hive_code: hive.hive_code,
            health_level: hive.strength_level || 'medium',
            queen_status: 'normal',
            frame_count: 10,
            load_order: checklistItems.length + 1,
            is_checked: false,
            notes: '',
        };
        setChecklistItems([...checklistItems, newItem]);
        setShowHiveSelector(false);
    };

    const removeHiveFromChecklist = (hiveId) => {
        setChecklistItems(
            checklistItems
                .filter((item) => item.hive_id !== hiveId)
                .map((item, idx) => ({ ...item, load_order: idx + 1 }))
        );
    };

    const updateChecklistItem = (hiveId, field, value) => {
        setChecklistItems(
            checklistItems.map((item) =>
                item.hive_id === hiveId ? { ...item, [field]: value } : item
            )
        );
    };

    const toggleChecklistItem = (hiveId) => {
        setChecklistItems(
            checklistItems.map((item) =>
                item.hive_id === hiveId ? { ...item, is_checked: !item.is_checked } : item
            )
        );
    };

    const openChecklistModal = (plan) => {
        setSelectedPlan(plan);
        setChecklistItems(plan.hive_list || []);
        setShowChecklistModal(true);
    };

    const isBloomingSoon = (bloomStart) => {
        const now = new Date();
        const start = new Date(bloomStart);
        const diffDays = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
        return diffDays <= 30 && diffDays >= 0;
    };

    const getBloomProgress = (bloomStart, bloomEnd) => {
        const now = new Date();
        const start = new Date(bloomStart);
        const end = new Date(bloomEnd);
        const total = end - start;
        const elapsed = now - start;
        if (elapsed < 0) return 0;
        if (elapsed > total) return 1;
        return elapsed / total;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white">
            <div className="max-w-7xl mx-auto px-4 py-6">
                <Header />

                <div className="mt-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-500/20">
                                <Map className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-white">转场地图</h2>
                                <p className="text-sm text-slate-400">追花夺蜜 · 花期规划 · 转场管理</p>
                            </div>
                        </div>
                        {canCreate && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => openNectarModal()}
                                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    <Flower2 className="w-4 h-4" />
                                    添加花期
                                </button>
                                <button
                                    onClick={() => openPlanModal()}
                                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-2 transition-colors"
                                >
                                    <Truck className="w-4 h-4" />
                                    新建转场
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={() => setActiveTab('map')}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                activeTab === 'map'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <Map className="w-4 h-4" />
                                地图视图
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('plans')}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                activeTab === 'plans'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:text-white'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <ListChecks className="w-4 h-4" />
                                转场计划
                            </span>
                        </button>
                    </div>

                    {activeTab === 'map' && (
                        <div className="glass-card rounded-3xl p-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">未来 60 天花期分布</h3>
                                    <p className="text-sm text-slate-400">
                                        共 {nectarCalendars.length} 个蜜源花期点
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleZoom(1.2)}
                                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                                        title="放大"
                                    >
                                        <ZoomIn className="w-4 h-4 text-slate-300" />
                                    </button>
                                    <button
                                        onClick={() => handleZoom(0.8)}
                                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                                        title="缩小"
                                    >
                                        <ZoomOut className="w-4 h-4 text-slate-300" />
                                    </button>
                                    <button
                                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                                        title="拖拽移动"
                                    >
                                        <Move className="w-4 h-4 text-slate-300" />
                                    </button>
                                </div>
                            </div>

                            <div className="relative bg-slate-800/50 rounded-2xl overflow-hidden border border-slate-700" style={{ height: '500px' }}>
                                <svg
                                    ref={svgRef}
                                    width="100%"
                                    height="100%"
                                    viewBox="0 0 800 600"
                                    className={`cursor-${isDragging ? 'grabbing' : isPickingSource || isPickingDestination ? 'crosshair' : 'grab'}`}
                                    onMouseDown={handleSvgMouseDown}
                                    onMouseMove={handleSvgMouseMove}
                                    onMouseUp={handleSvgMouseUp}
                                    onMouseLeave={handleSvgMouseUp}
                                    onClick={handleMapClick}
                                    style={{
                                        transform: `translate(${mapView.centerX - 400}px, ${mapView.centerY - 300}px) scale(${mapView.scale})`,
                                        transformOrigin: 'center center',
                                    }}
                                >
                                    <defs>
                                        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#334155" strokeWidth="0.5" />
                                        </pattern>
                                    </defs>
                                    <rect width="800" height="600" fill="url(#grid)" />

                                    <path
                                        d="M 150 100 Q 200 80 300 120 T 500 100 T 700 150 L 750 200 Q 720 300 700 400 T 600 500 Q 450 550 300 520 T 100 450 Q 50 300 100 200 Z"
                                        fill="#1e293b"
                                        stroke="#475569"
                                        strokeWidth="2"
                                    />

                                    {nectarCalendars.map((nectar) => {
                                        const pos = latLngToSvg(nectar.location_lat, nectar.location_lng);
                                        const isSoon = isBloomingSoon(nectar.bloom_start_date);
                                        const progress = getBloomProgress(nectar.bloom_start_date, nectar.bloom_end_date);

                                        return (
                                            <g
                                                key={nectar.id}
                                                transform={`translate(${pos.x}, ${pos.y})`}
                                                className="cursor-pointer"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNectarClick(nectar);
                                                }}
                                            >
                                                <circle
                                                    r={isSoon ? 25 : 15}
                                                    fill={nectar.color}
                                                    fillOpacity={0.3 + progress * 0.4}
                                                    className={`transition-all duration-300 ${isSoon ? 'animate-pulse' : ''}`}
                                                />
                                                <circle
                                                    r={8}
                                                    fill={nectar.color}
                                                    stroke="#fff"
                                                    strokeWidth="2"
                                                />
                                                <text
                                                    y={-18}
                                                    textAnchor="middle"
                                                    className="text-xs fill-white font-medium"
                                                    style={{ fontSize: '11px' }}
                                                >
                                                    {nectar.plant_name}
                                                </text>
                                            </g>
                                        );
                                    })}

                                    {showPlanModal && (
                                        <>
                                            <g transform={`translate(${latLngToSvg(planFormData.source_lat, planFormData.source_lng).x}, ${latLngToSvg(planFormData.source_lat, planFormData.source_lng).y})`}>
                                                <circle r="10" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                                                <text y={-15} textAnchor="middle" className="text-xs fill-blue-400 font-medium" style={{ fontSize: '10px' }}>
                                                    出发地
                                                </text>
                                            </g>
                                            <g transform={`translate(${latLngToSvg(planFormData.destination_lat, planFormData.destination_lng).x}, ${latLngToSvg(planFormData.destination_lat, planFormData.destination_lng).y})`}>
                                                <circle r="10" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
                                                <text y={-15} textAnchor="middle" className="text-xs fill-amber-400 font-medium" style={{ fontSize: '10px' }}>
                                                    目的地
                                                </text>
                                            </g>
                                            <line
                                                x1={latLngToSvg(planFormData.source_lat, planFormData.source_lng).x}
                                                y1={latLngToSvg(planFormData.source_lat, planFormData.source_lng).y}
                                                x2={latLngToSvg(planFormData.destination_lat, planFormData.destination_lng).x}
                                                y2={latLngToSvg(planFormData.destination_lat, planFormData.destination_lng).y}
                                                stroke="#60a5fa"
                                                strokeWidth="2"
                                                strokeDasharray="5,5"
                                            />
                                        </>
                                    )}
                                </svg>

                                {(isPickingSource || isPickingDestination) && (
                                    <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-amber-500/90 text-white rounded-lg font-medium text-sm">
                                        {isPickingSource ? '点击地图选择出发地' : '点击地图选择目的地'}
                                        <button
                                            onClick={() => {
                                                setIsPickingSource(false);
                                                setIsPickingDestination(false);
                                            }}
                                            className="ml-3 text-amber-100 hover:text-white"
                                        >
                                            取消
                                        </button>
                                    </div>
                                )}

                                <div className="absolute bottom-4 left-4 bg-slate-900/90 rounded-xl p-3 border border-slate-700">
                                    <p className="text-xs text-slate-400 mb-2">蜜源图例</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {plantTypes.slice(0, 6).map((type) => (
                                            <div key={type.value} className="flex items-center gap-1.5">
                                                <div
                                                    className="w-3 h-3 rounded-full"
                                                    style={{ backgroundColor: type.color }}
                                                />
                                                <span className="text-[10px] text-slate-300">{type.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {selectedNectar && (
                                <div className="mt-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-10 h-10 rounded-xl flex items-center justify-center"
                                                style={{ backgroundColor: selectedNectar.color + '30' }}
                                            >
                                                <Flower2 className="w-5 h-5" style={{ color: selectedNectar.color }} />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-white">{selectedNectar.plant_name}</h4>
                                                <p className="text-sm text-slate-400">{selectedNectar.plant_type_name} · {selectedNectar.location_name}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedNectar(null)}
                                            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                                        >
                                            <X className="w-4 h-4 text-slate-400" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 mt-4">
                                        <div>
                                            <p className="text-xs text-slate-500">开花时间</p>
                                            <p className="text-sm text-white font-medium">
                                                {formatDate(selectedNectar.bloom_start_date)} ~ {formatDate(selectedNectar.bloom_end_date)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-500">可承载蜂群</p>
                                            <p className="text-sm text-white font-medium">
                                                {selectedNectar.max_hive_capacity} 群
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-500">蜜质等级</p>
                                            <p className="text-sm text-white font-medium">
                                                {selectedNectar.nectar_quality || '-'}
                                            </p>
                                        </div>
                                    </div>
                                    {selectedNectar.notes && (
                                        <div className="mt-3 pt-3 border-t border-slate-700">
                                            <p className="text-xs text-slate-500 mb-1">备注</p>
                                            <p className="text-sm text-slate-300">{selectedNectar.notes}</p>
                                        </div>
                                    )}
                                    <div className="flex gap-2 mt-4">
                                        {canUpdate && (
                                            <button
                                                onClick={() => openNectarModal(selectedNectar)}
                                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                                            >
                                                编辑
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button
                                                onClick={() => handleDeleteNectar(selectedNectar.id)}
                                                className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium transition-colors"
                                            >
                                                删除
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'plans' && (
                        <div className="glass-card rounded-3xl p-6">
                            <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-2">
                                    <Truck className="w-5 h-5 text-blue-400" />
                                    <h3 className="text-lg font-semibold text-white">转场计划列表</h3>
                                </div>
                                {canCreate && (
                                    <button
                                        onClick={() => openPlanModal()}
                                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2 transition-colors"
                                    >
                                        <Plus className="w-4 h-4" />
                                        新建转场
                                    </button>
                                )}
                            </div>

                            {plansLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : relocationPlans.length > 0 ? (
                                <div className="space-y-3">
                                    {relocationPlans.map((plan) => (
                                        <div
                                            key={plan.id}
                                            className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-all"
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2.5 bg-blue-500/20 rounded-xl">
                                                        <Truck className="w-5 h-5 text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-semibold text-white">{plan.plan_name}</h4>
                                                        <p className="text-sm text-slate-400">
                                                            {plan.source_location_name} → {plan.destination_location_name}
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${STATUS_COLORS[plan.status]}`}>
                                                    {plan.status_name}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-4 gap-4 mt-4">
                                                <div>
                                                    <p className="text-xs text-slate-500">出发时间</p>
                                                    <p className="text-sm text-white font-medium">
                                                        {formatDateTime(plan.departure_date)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">预计距离</p>
                                                    <p className="text-sm text-white font-medium">
                                                        {plan.distance_km ? `${plan.distance_km} 公里` : '-'}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">装车蜂箱</p>
                                                    <p className="text-sm text-white font-medium">
                                                        {plan.hive_list?.length || 0} 箱
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">随行人员</p>
                                                    <p className="text-sm text-white font-medium">
                                                        {plan.beekeepers?.length || 0} 人
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-700/50">
                                                <button
                                                    onClick={() => openChecklistModal(plan)}
                                                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
                                                >
                                                    <ListChecks className="w-3.5 h-3.5" />
                                                    转场清单
                                                </button>
                                                <button
                                                    onClick={() => handleExportChecklist(plan.id)}
                                                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                    导出
                                                </button>
                                                {plan.status === 'planned' && canUpdate && (
                                                    <>
                                                        <button
                                                            onClick={() => openPlanModal(plan)}
                                                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                                                        >
                                                            编辑
                                                        </button>
                                                        <button
                                                            onClick={() => handleStartRelocation(plan.id)}
                                                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
                                                        >
                                                            <Play className="w-3.5 h-3.5" />
                                                            开始转场
                                                        </button>
                                                        <button
                                                            onClick={() => handleCancelRelocation(plan.id)}
                                                            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors ml-auto"
                                                        >
                                                            <XCircle className="w-3.5 h-3.5" />
                                                            取消
                                                        </button>
                                                    </>
                                                )}
                                                {plan.status === 'in_transit' && canUpdate && (
                                                    <button
                                                        onClick={() => handleCompleteRelocation(plan.id)}
                                                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium flex items-center gap-1.5 transition-colors ml-auto"
                                                    >
                                                        <CheckCircle className="w-3.5 h-3.5" />
                                                        完成转场
                                                    </button>
                                                )}
                                                {plan.status === 'completed' && (
                                                    <span className="ml-auto text-xs text-emerald-400 flex items-center gap-1">
                                                        <CheckCircle className="w-4 h-4" />
                                                        已于 {formatDateTime(plan.completed_at)} 完成
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <Truck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                    <p className="text-slate-500">暂无转场计划</p>
                                    {canCreate && (
                                        <button
                                            onClick={() => openPlanModal()}
                                            className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                                        >
                                            创建第一个转场计划
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showNectarModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-5 border-b border-slate-700">
                            <h3 className="text-lg font-semibold text-white">
                                {editingNectar ? '编辑花期日历' : '新建花期日历'}
                            </h3>
                            <button
                                onClick={() => setShowNectarModal(false)}
                                className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                        <form onSubmit={handleNectarSubmit} className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">蜜源植物类型</label>
                                    <select
                                        value={nectarFormData.plant_type}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, plant_type: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                    >
                                        {plantTypes.map((type) => (
                                            <option key={type.value} value={type.value}>
                                                {type.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">植物名称</label>
                                    <input
                                        type="text"
                                        value={nectarFormData.plant_name}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, plant_name: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        placeholder="如：江西油菜花"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">地理位置名称</label>
                                <input
                                    type="text"
                                    value={nectarFormData.location_name}
                                    onChange={(e) => setNectarFormData({ ...nectarFormData, location_name: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                    placeholder="如：江西省婺源县"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">纬度</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        value={nectarFormData.location_lat}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, location_lat: parseFloat(e.target.value) })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">经度</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        value={nectarFormData.location_lng}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, location_lng: parseFloat(e.target.value) })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">开花开始日期</label>
                                    <input
                                        type="datetime-local"
                                        value={nectarFormData.bloom_start_date}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, bloom_start_date: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">开花结束日期</label>
                                    <input
                                        type="datetime-local"
                                        value={nectarFormData.bloom_end_date}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, bloom_end_date: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">可承载蜂群数</label>
                                    <input
                                        type="number"
                                        value={nectarFormData.max_hive_capacity}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, max_hive_capacity: parseInt(e.target.value) })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        min="1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">蜜质等级</label>
                                    <input
                                        type="text"
                                        value={nectarFormData.nectar_quality}
                                        onChange={(e) => setNectarFormData({ ...nectarFormData, nectar_quality: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500"
                                        placeholder="如：一级、优"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">备注</label>
                                <textarea
                                    value={nectarFormData.notes}
                                    onChange={(e) => setNectarFormData({ ...nectarFormData, notes: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-emerald-500 resize-none"
                                    rows="3"
                                    placeholder="可选备注信息"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-3 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setShowNectarModal(false)}
                                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={nectarSubmitting}
                                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {nectarSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {editingNectar ? '保存修改' : '创建花期'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showPlanModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-5 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
                            <h3 className="text-lg font-semibold text-white">
                                {editingPlan ? '编辑转场计划' : '新建转场计划'}
                            </h3>
                            <button
                                onClick={() => setShowPlanModal(false)}
                                className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                        <form onSubmit={handlePlanSubmit} className="p-5 space-y-5">
                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">计划名称</label>
                                <input
                                    type="text"
                                    value={planFormData.plan_name}
                                    onChange={(e) => setPlanFormData({ ...planFormData, plan_name: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
                                    placeholder="如：春季江西转场"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Navigation className="w-4 h-4 text-blue-400" />
                                        <span className="text-sm font-medium text-blue-400">出发地</span>
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">蜂场ID</label>
                                            <input
                                                type="text"
                                                value={planFormData.source_apiary_id}
                                                onChange={(e) => setPlanFormData({ ...planFormData, source_apiary_id: e.target.value })}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">地点名称</label>
                                            <input
                                                type="text"
                                                value={planFormData.source_location_name}
                                                onChange={(e) => setPlanFormData({ ...planFormData, source_location_name: e.target.value })}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">纬度</label>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    value={planFormData.source_lat}
                                                    onChange={(e) => setPlanFormData({ ...planFormData, source_lat: parseFloat(e.target.value) })}
                                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">经度</label>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    value={planFormData.source_lng}
                                                    onChange={(e) => setPlanFormData({ ...planFormData, source_lng: parseFloat(e.target.value) })}
                                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsPickingSource(true);
                                                setShowPlanModal(false);
                                            }}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 text-xs font-medium transition-colors flex items-center justify-center gap-1"
                                        >
                                            <MapPin className="w-3 h-3" />
                                            在地图上选点
                                        </button>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                    <div className="flex items-center gap-2 mb-3">
                                        <MapPin className="w-4 h-4 text-amber-400" />
                                        <span className="text-sm font-medium text-amber-400">目的地</span>
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">蜂场ID</label>
                                            <input
                                                type="text"
                                                value={planFormData.destination_apiary_id}
                                                onChange={(e) => setPlanFormData({ ...planFormData, destination_apiary_id: e.target.value })}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-amber-500"
                                                placeholder="如：jiangxi-rapeseed"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">地点名称</label>
                                            <input
                                                type="text"
                                                value={planFormData.destination_location_name}
                                                onChange={(e) => setPlanFormData({ ...planFormData, destination_location_name: e.target.value })}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-amber-500"
                                                placeholder="如：江西婺源"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">纬度</label>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    value={planFormData.destination_lat}
                                                    onChange={(e) => setPlanFormData({ ...planFormData, destination_lat: parseFloat(e.target.value) })}
                                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-amber-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-slate-400 mb-1">经度</label>
                                                <input
                                                    type="number"
                                                    step="0.0001"
                                                    value={planFormData.destination_lng}
                                                    onChange={(e) => setPlanFormData({ ...planFormData, destination_lng: parseFloat(e.target.value) })}
                                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:border-amber-500"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsPickingDestination(true);
                                                setShowPlanModal(false);
                                            }}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 text-xs font-medium transition-colors flex items-center justify-center gap-1"
                                        >
                                            <MapPin className="w-3 h-3" />
                                            在地图上选点
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 rounded-xl bg-slate-700/50 border border-slate-600">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-emerald-400" />
                                        <span className="text-sm font-medium text-white">距离估算</span>
                                    </div>
                                    {estimatingDistance ? (
                                        <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            计算中...
                                        </div>
                                    ) : distanceEstimate ? (
                                        <div className="text-right">
                                            <p className="text-lg font-bold text-emerald-400">
                                                {distanceEstimate.distance_km} 公里
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                预计 {distanceEstimate.estimated_duration_hours} 小时
                                            </p>
                                        </div>
                                    ) : (
                                        <span className="text-slate-500 text-sm">自动计算</span>
                                    )}
                                </div>
                                {distanceEstimate?.estimated_arrival_time && (
                                    <p className="text-xs text-slate-400 mt-2">
                                        预计到达时间：{formatDateTime(distanceEstimate.estimated_arrival_time)}
                                    </p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">出发日期时间</label>
                                    <input
                                        type="datetime-local"
                                        value={planFormData.departure_date}
                                        onChange={(e) => setPlanFormData({ ...planFormData, departure_date: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-slate-400 mb-1.5">运输车辆</label>
                                    <input
                                        type="text"
                                        value={planFormData.transport_vehicle}
                                        onChange={(e) => setPlanFormData({ ...planFormData, transport_vehicle: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500"
                                        placeholder="车牌号或车型"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">
                                    <Users className="w-4 h-4 inline mr-1" />
                                    随行养蜂员（每行一个）
                                </label>
                                <textarea
                                    value={planFormData.beekeepers.join('\n')}
                                    onChange={(e) => setPlanFormData({ ...planFormData, beekeepers: e.target.value.split('\n').filter(Boolean) })}
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500 resize-none"
                                    rows="2"
                                    placeholder="张三&#10;李四"
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm text-slate-400 font-medium">
                                        <Box className="w-4 h-4 inline mr-1" />
                                        装车蜂箱清单
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setShowHiveSelector(true)}
                                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                    >
                                        <Plus className="w-3 h-3" />
                                        添加蜂箱
                                    </button>
                                </div>
                                {checklistItems.length > 0 ? (
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {checklistItems
                                            .sort((a, b) => (a.load_order || 0) - (b.load_order || 0))
                                            .map((item) => (
                                                <div
                                                    key={item.hive_id}
                                                    className="p-3 rounded-xl bg-slate-700/50 border border-slate-600"
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold flex items-center justify-center">
                                                                {item.load_order}
                                                            </span>
                                                            <span className="font-medium text-white text-sm">
                                                                {item.hive_code}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeHiveFromChecklist(item.hive_id)}
                                                            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                                        <div>
                                                            <span className="text-slate-500">健康度：</span>
                                                            <select
                                                                value={item.health_level}
                                                                onChange={(e) => updateChecklistItem(item.hive_id, 'health_level', e.target.value)}
                                                                className="bg-slate-700 border border-slate-600 rounded text-white text-xs px-1.5 py-0.5"
                                                            >
                                                                {Object.entries(STRENGTH_LEVEL_NAMES).map(([value, label]) => (
                                                                    <option key={value} value={value}>{label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <span className="text-slate-500">蜂王：</span>
                                                            <select
                                                                value={item.queen_status}
                                                                onChange={(e) => updateChecklistItem(item.hive_id, 'queen_status', e.target.value)}
                                                                className="bg-slate-700 border border-slate-600 rounded text-white text-xs px-1.5 py-0.5"
                                                            >
                                                                {QUEEN_STATUS_OPTIONS.map((opt) => (
                                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <span className="text-slate-500">巢框：</span>
                                                            <input
                                                                type="number"
                                                                value={item.frame_count}
                                                                onChange={(e) => updateChecklistItem(item.hive_id, 'frame_count', parseInt(e.target.value))}
                                                                className="w-16 bg-slate-700 border border-slate-600 rounded text-white text-xs px-1.5 py-0.5"
                                                                min="1"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-6 bg-slate-700/30 rounded-xl border border-dashed border-slate-600">
                                        <Box className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                                        <p className="text-slate-500 text-sm">暂无装车蜂箱</p>
                                        <button
                                            type="button"
                                            onClick={() => setShowHiveSelector(true)}
                                            className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
                                        >
                                            点击添加
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm text-slate-400 mb-1.5">备注</label>
                                <textarea
                                    value={planFormData.notes}
                                    onChange={(e) => setPlanFormData({ ...planFormData, notes: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:border-blue-500 resize-none"
                                    rows="2"
                                    placeholder="可选备注信息"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setShowPlanModal(false)}
                                    className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={planSubmitting}
                                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {planSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {editingPlan ? '保存修改' : '创建转场'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showHiveSelector && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg max-h-[80vh] overflow-hidden">
                        <div className="flex items-center justify-between p-5 border-b border-slate-700">
                            <h3 className="text-lg font-semibold text-white">选择蜂箱</h3>
                            <button
                                onClick={() => setShowHiveSelector(false)}
                                className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-96">
                            {hivesLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                </div>
                            ) : hives.length > 0 ? (
                                <div className="space-y-2">
                                    {hives
                                        .filter((h) => h.status === 'active')
                                        .filter((h) => !checklistItems.find((item) => item.hive_id === h.id))
                                        .map((hive) => (
                                            <button
                                                key={hive.id}
                                                onClick={() => addHiveToChecklist(hive)}
                                                className="w-full p-3 rounded-xl bg-slate-700/50 hover:bg-slate-700 border border-slate-600 hover:border-blue-500/50 transition-all text-left"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="font-medium text-white">{hive.hive_code}</p>
                                                        <p className="text-xs text-slate-400">{hive.apiary_id}</p>
                                                    </div>
                                                    <span className="text-xs text-slate-400">
                                                        {hive.strength_level_name || hive.strength_level}群势
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                </div>
                            ) : (
                                <div className="text-center py-8">
                                    <Box className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                                    <p className="text-slate-500">暂无可用蜂箱</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showChecklistModal && selectedPlan && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-hidden">
                        <div className="flex items-center justify-between p-5 border-b border-slate-700">
                            <div>
                                <h3 className="text-lg font-semibold text-white">转场清单</h3>
                                <p className="text-sm text-slate-400">{selectedPlan.plan_name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handleExportChecklist(selectedPlan.id)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
                                >
                                    <Download className="w-4 h-4" />
                                    导出CSV
                                </button>
                                <button
                                    onClick={() => setShowChecklistModal(false)}
                                    className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                                >
                                    <X className="w-5 h-5 text-slate-400" />
                                </button>
                            </div>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-[60vh]">
                            {checklistItems.length > 0 ? (
                                <div className="space-y-2">
                                    {checklistItems
                                        .sort((a, b) => (a.load_order || 0) - (b.load_order || 0))
                                        .map((item) => (
                                            <div
                                                key={item.hive_id}
                                                className={`p-4 rounded-xl border transition-all ${
                                                    item.is_checked
                                                        ? 'bg-emerald-500/10 border-emerald-500/30'
                                                        : 'bg-slate-700/50 border-slate-600'
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <button
                                                        onClick={() => toggleChecklistItem(item.hive_id)}
                                                        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                                            item.is_checked
                                                                ? 'bg-emerald-500 border-emerald-500'
                                                                : 'border-slate-500 hover:border-slate-400'
                                                        }`}
                                                    >
                                                        {item.is_checked && <Check className="w-3 h-3 text-white" />}
                                                    </button>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold flex items-center justify-center">
                                                                {item.load_order}
                                                            </span>
                                                            <span className="font-semibold text-white">
                                                                {item.hive_code}
                                                            </span>
                                                        </div>
                                                        <div className="grid grid-cols-3 gap-3 text-xs">
                                                            <div>
                                                                <span className="text-slate-500">健康度：</span>
                                                                <span className="text-slate-300">
                                                                    {STRENGTH_LEVEL_NAMES[item.health_level] || item.health_level}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-slate-500">蜂王：</span>
                                                                <span className="text-slate-300">
                                                                    {QUEEN_STATUS_OPTIONS.find((o) => o.value === item.queen_status)?.label || item.queen_status}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span className="text-slate-500">巢框：</span>
                                                                <span className="text-slate-300">{item.frame_count} 个</span>
                                                            </div>
                                                        </div>
                                                        {item.notes && (
                                                            <p className="text-xs text-slate-500 mt-2">备注：{item.notes}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <ListChecks className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                    <p className="text-slate-500">暂无清单数据</p>
                                </div>
                            )}
                        </div>
                        <div className="p-5 border-t border-slate-700">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400">
                                    共 {checklistItems.length} 箱
                                </span>
                                <span className="text-emerald-400">
                                    已检查 {checklistItems.filter((i) => i.is_checked).length} 箱
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RelocationMap;
