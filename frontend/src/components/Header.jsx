import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Activity, User, MapPin, LogOut, Shield, ChevronDown } from 'lucide-react';

const ROLE_COLORS = {
    farm_owner: 'text-purple-400 bg-purple-500/20',
    beekeeper: 'text-amber-400 bg-amber-500/20',
    technician: 'text-cyan-400 bg-cyan-500/20',
    auditor: 'text-teal-400 bg-teal-500/20',
};

const Header = () => {
    const { user, logout } = useAuth();
    const [showDropdown, setShowDropdown] = useState(false);

    if (!user) return null;

    const roleColorClass = ROLE_COLORS[user.role] || 'text-slate-400 bg-slate-500/20';
    const farmDisplay = user.farm_scope && user.farm_scope.length > 0
        ? user.farm_scope.slice(0, 2).map(f => f.split(' - ')[0]).join('、')
        : '未分配';
    const hasMultipleFarms = user.farm_scope && user.farm_scope.length > 2;

    return (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700 pb-8">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20">
                    <Activity className="w-8 h-8 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Prometheus 监控实战</h1>
                    <p className="text-slate-400">React + FastAPI + Prometheus + Grafana 示例工程</p>
                </div>
            </div>

            <div className="relative">
                <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-all"
                >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shrink-0">
                        <User className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left hidden sm:block">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-white text-sm">{user.username}</span>
                            <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${roleColorClass} flex items-center gap-1`}>
                                <Shield className="w-3 h-3" />
                                {user.role_name || user.role}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            <span className="truncate max-w-[200px]">
                                {farmDisplay}{hasMultipleFarms && ` 等${user.farm_scope.length}个`}
                            </span>
                        </div>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showDropdown && (
                    <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl bg-slate-800 border border-slate-700 shadow-xl shadow-black/20 z-50 overflow-hidden">
                        <div className="p-4 border-b border-slate-700">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                    <User className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <p className="font-semibold text-white">{user.username}</p>
                                    <p className={`text-sm ${roleColorClass.split(' ')[0]} flex items-center gap-1`}>
                                        <Shield className="w-3.5 h-3.5" />
                                        {user.role_name || user.role}
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-start gap-2 text-xs">
                                    <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                                    <div>
                                        <span className="text-slate-500">可访问蜂场：</span>
                                        <div className="text-slate-300 mt-1 space-y-1">
                                            {user.farm_scope && user.farm_scope.length > 0 ? (
                                                user.farm_scope.map((farm, idx) => (
                                                    <p key={idx}>{farm}</p>
                                                ))
                                            ) : (
                                                <p className="text-slate-500 italic">未分配</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-3">
                            <div className="mb-3">
                                <p className="text-xs text-slate-500 mb-2">拥有权限</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {user.permissions && user.permissions.map((perm, idx) => (
                                        <span
                                            key={idx}
                                            className="px-2 py-1 rounded-md bg-slate-700/50 text-slate-300 text-xs"
                                        >
                                            {perm}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <button
                                onClick={logout}
                                className="w-full px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 font-medium flex items-center justify-center gap-2 transition-colors text-sm"
                            >
                                <LogOut className="w-4 h-4" />
                                退出登录
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
};

export default Header;
