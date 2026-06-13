import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, Lock, UserPlus, Shield, Eye, EyeOff, Check, X, MapPin } from 'lucide-react';
import { toast } from 'react-toastify';

const ROLE_OPTIONS = [
    { value: 'farm_owner', label: '场主', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
    { value: 'beekeeper', label: '养蜂员', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    { value: 'technician', label: '技术员', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/30' },
    { value: 'auditor', label: '外部审计', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/30' },
];

const AVAILABLE_FARMS = [
    '蜂场A - 西山养殖基地',
    '蜂场B - 东湖养蜂场',
    '蜂场C - 南岭蜜源区',
    '蜂场D - 北坡生态场',
];

const calculatePasswordStrength = (password) => {
    let score = 0;
    const checks = {
        length: password.length >= 8,
        lowercase: /[a-z]/.test(password),
        uppercase: /[A-Z]/.test(password),
        numbers: /[0-9]/.test(password),
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    };

    score = Object.values(checks).filter(Boolean).length;

    let label = '';
    let color = '';
    let barColor = '';
    let percent = 0;

    if (score === 0) {
        label = '未输入';
        color = 'text-slate-500';
        barColor = 'bg-slate-700';
        percent = 0;
    } else if (score <= 1) {
        label = '非常弱';
        color = 'text-red-400';
        barColor = 'bg-red-500';
        percent = 20;
    } else if (score === 2) {
        label = '弱';
        color = 'text-orange-400';
        barColor = 'bg-orange-500';
        percent = 40;
    } else if (score === 3) {
        label = '中等';
        color = 'text-yellow-400';
        barColor = 'bg-yellow-500';
        percent = 60;
    } else if (score === 4) {
        label = '强';
        color = 'text-lime-400';
        barColor = 'bg-lime-500';
        percent = 80;
    } else {
        label = '非常强';
        color = 'text-green-400';
        barColor = 'bg-green-500';
        percent = 100;
    }

    return { score, checks, label, color, barColor, percent };
};

const Register = () => {
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        confirm_password: '',
        role: '',
        farm_scope: [],
    });
    const [errors, setErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const { register, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    if (isAuthenticated) {
        navigate('/', { replace: true });
    }

    const passwordStrength = useMemo(
        () => calculatePasswordStrength(formData.password),
        [formData.password]
    );

    const validate = () => {
        const newErrors = {};
        const username = formData.username.trim();

        if (!username) {
            newErrors.username = '请输入用户名';
        } else if (username.length < 3) {
            newErrors.username = '用户名至少3个字符';
        } else if (username.length > 50) {
            newErrors.username = '用户名不能超过50个字符';
        }

        if (!formData.password) {
            newErrors.password = '请输入密码';
        } else if (formData.password.length < 8) {
            newErrors.password = '密码至少8位';
        } else if (passwordStrength.score < 2) {
            newErrors.password = '密码强度太弱，请增加复杂度';
        }

        if (!formData.confirm_password) {
            newErrors.confirm_password = '请确认密码';
        } else if (formData.password !== formData.confirm_password) {
            newErrors.confirm_password = '两次输入的密码不一致';
        }

        if (!formData.role) {
            newErrors.role = '请选择角色';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setSubmitting(true);
        try {
            const success = await register({
                username: formData.username.trim(),
                password: formData.password,
                confirm_password: formData.confirm_password,
                role: formData.role,
                farm_scope: formData.farm_scope,
            });
            if (success) {
                navigate('/', { replace: true });
            }
        } catch (error) {
            toast.error('注册过程中发生错误');
        } finally {
            setSubmitting(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const handleFarmToggle = (farm) => {
        setFormData(prev => ({
            ...prev,
            farm_scope: prev.farm_scope.includes(farm)
                ? prev.farm_scope.filter(f => f !== farm)
                : [...prev.farm_scope, farm],
        }));
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 py-8">
            <div className="w-full max-w-lg">
                <div className="glass-card rounded-3xl p-8 space-y-6">
                    <div className="text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600 rounded-2xl shadow-lg shadow-purple-500/20 mx-auto">
                            <UserPlus className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">创建账号</h1>
                            <p className="text-slate-400 mt-1">加入蜂场监控管理系统</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">用户名</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                <input
                                    type="text"
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    placeholder="请输入用户名（3-50字符）"
                                    autoComplete="username"
                                    className={`w-full pl-11 pr-4 py-3 rounded-xl bg-slate-900 border ${
                                        errors.username ? 'border-red-500' : 'border-slate-700'
                                    } focus:border-blue-500 outline-none transition-all text-white placeholder-slate-600`}
                                />
                            </div>
                            {errors.username && (
                                <p className="text-sm text-red-400">{errors.username}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">角色选择</label>
                            <div className="grid grid-cols-2 gap-3">
                                {ROLE_OPTIONS.map((role) => (
                                    <button
                                        key={role.value}
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, role: role.value }));
                                            if (errors.role) {
                                                setErrors(prev => ({ ...prev, role: '' }));
                                            }
                                        }}
                                        className={`p-3 rounded-xl border text-left transition-all ${
                                            formData.role === role.value
                                                ? `${role.bg} ${role.color} ring-2 ring-offset-2 ring-offset-slate-900`
                                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
                                        }`}
                                        style={formData.role === role.value ? { borderColor: 'currentColor' } : {}}
                                    >
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-4 h-4" />
                                            <span className="font-medium text-sm">{role.label}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            {errors.role && (
                                <p className="text-sm text-red-400">{errors.role}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">可访问蜂场范围</label>
                            <div className="space-y-2">
                                {AVAILABLE_FARMS.map((farm) => (
                                    <button
                                        key={farm}
                                        type="button"
                                        onClick={() => handleFarmToggle(farm)}
                                        className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                                            formData.farm_scope.includes(farm)
                                                ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
                                        }`}
                                    >
                                        <MapPin className="w-4 h-4 shrink-0" />
                                        <span className="text-sm">{farm}</span>
                                        {formData.farm_scope.includes(farm) && (
                                            <Check className="w-4 h-4 ml-auto shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500">
                                可多选，未选择则默认访问空范围
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder="至少8位，建议混合字符"
                                    autoComplete="new-password"
                                    className={`w-full pl-11 pr-11 py-3 rounded-xl bg-slate-900 border ${
                                        errors.password ? 'border-red-500' : 'border-slate-700'
                                    } focus:border-blue-500 outline-none transition-all text-white placeholder-slate-600`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>

                            {formData.password && (
                                <div className="space-y-2 pt-1">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                                            <div
                                                className={`h-full ${passwordStrength.barColor} transition-all duration-300`}
                                                style={{ width: `${passwordStrength.percent}%` }}
                                            />
                                        </div>
                                        <span className={`text-xs font-medium ${passwordStrength.color}`}>
                                            {passwordStrength.label}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                        {Object.entries(passwordStrength.checks).map(([key, passed]) => {
                                            const labels = {
                                                length: '至少8位',
                                                lowercase: '含小写字母',
                                                uppercase: '含大写字母',
                                                numbers: '含数字',
                                                special: '含特殊字符',
                                            };
                                            return (
                                                <div
                                                    key={key}
                                                    className={`flex items-center gap-1.5 ${
                                                        passed ? 'text-green-400' : 'text-slate-500'
                                                    }`}
                                                >
                                                    {passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                                    {labels[key]}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {errors.password && (
                                <p className="text-sm text-red-400">{errors.password}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">确认密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    name="confirm_password"
                                    value={formData.confirm_password}
                                    onChange={handleChange}
                                    placeholder="请再次输入密码"
                                    autoComplete="new-password"
                                    className={`w-full pl-11 pr-11 py-3 rounded-xl bg-slate-900 border ${
                                        errors.confirm_password ? 'border-red-500' : 'border-slate-700'
                                    } focus:border-blue-500 outline-none transition-all text-white placeholder-slate-600`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                >
                                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                            {errors.confirm_password && (
                                <p className="text-sm text-red-400">{errors.confirm_password}</p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors text-white mt-2"
                        >
                            {submitting ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <UserPlus className="w-5 h-5" />
                                    注册账号
                                </>
                            )}
                        </button>
                    </form>

                    <div className="text-center text-slate-400 text-sm">
                        已有账号？{' '}
                        <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                            立即登录
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Register;
