import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, Lock, LogIn, Shield } from 'lucide-react';
import { toast } from 'react-toastify';

const Login = () => {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [errors, setErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const { login, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const from = location.state?.from?.pathname || '/';

    if (isAuthenticated) {
        navigate(from, { replace: true });
    }

    const validate = () => {
        const newErrors = {};
        if (!formData.username.trim()) {
            newErrors.username = '请输入用户名';
        } else if (formData.username.trim().length < 3) {
            newErrors.username = '用户名至少3个字符';
        }
        if (!formData.password) {
            newErrors.password = '请输入密码';
        } else if (formData.password.length < 8) {
            newErrors.password = '密码至少8位';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;

        setSubmitting(true);
        try {
            const success = await login(formData.username.trim(), formData.password);
            if (success) {
                navigate(from, { replace: true });
            }
        } catch (error) {
            toast.error('登录过程中发生错误');
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

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="glass-card rounded-3xl p-8 space-y-8">
                    <div className="text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20 mx-auto">
                            <Shield className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">欢迎回来</h1>
                            <p className="text-slate-400 mt-1">登录以继续使用蜂场监控系统</p>
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
                                    placeholder="请输入用户名"
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
                            <label className="text-sm font-medium text-slate-300">密码</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                <input
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder="请输入密码"
                                    autoComplete="current-password"
                                    className={`w-full pl-11 pr-4 py-3 rounded-xl bg-slate-900 border ${
                                        errors.password ? 'border-red-500' : 'border-slate-700'
                                    } focus:border-blue-500 outline-none transition-all text-white placeholder-slate-600`}
                                />
                            </div>
                            {errors.password && (
                                <p className="text-sm text-red-400">{errors.password}</p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors text-white"
                        >
                            {submitting ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <LogIn className="w-5 h-5" />
                                    登录
                                </>
                            )}
                        </button>
                    </form>

                    <div className="text-center text-slate-400 text-sm">
                        还没有账号？{' '}
                        <Link to="/register" className="text-blue-400 hover:text-blue-300 font-medium">
                            立即注册
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
