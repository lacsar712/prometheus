import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, TOKEN_KEY, REFRESH_TOKEN_KEY } from '../utils/api';
import { toast } from 'react-toastify';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    const saveTokens = (accessToken, refreshToken) => {
        localStorage.setItem(TOKEN_KEY, accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    };

    const clearTokens = () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem('auth_user');
    };

    const fetchCurrentUser = useCallback(async () => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const response = await authApi.getMe();
            setUser(response.data);
            setIsAuthenticated(true);
            localStorage.setItem('auth_user', JSON.stringify(response.data));
        } catch (error) {
            clearTokens();
            setUser(null);
            setIsAuthenticated(false);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const savedUser = localStorage.getItem('auth_user');
        if (savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setIsAuthenticated(true);
            } catch (e) {
                console.error('Failed to parse saved user:', e);
            }
        }
        fetchCurrentUser();
    }, [fetchCurrentUser]);

    const login = async (username, password) => {
        try {
            const response = await authApi.login(username, password);
            const { access_token, refresh_token } = response.data;
            saveTokens(access_token, refresh_token);
            await fetchCurrentUser();
            toast.success('登录成功！');
            return true;
        } catch (error) {
            const message = error.response?.data?.detail || '登录失败，请检查用户名和密码';
            toast.error(message);
            return false;
        }
    };

    const register = async (data) => {
        try {
            const response = await authApi.register(data);
            const { access_token, refresh_token } = response.data;
            saveTokens(access_token, refresh_token);
            await fetchCurrentUser();
            toast.success('注册成功！');
            return true;
        } catch (error) {
            if (error.response?.data?.detail) {
                const detail = error.response.data.detail;
                if (Array.isArray(detail)) {
                    detail.forEach(err => toast.error(err.msg || '注册失败'));
                } else {
                    toast.error(detail);
                }
            } else {
                toast.error('注册失败，请稍后重试');
            }
            return false;
        }
    };

    const logout = async () => {
        try {
            await authApi.logout();
        } catch (error) {
        } finally {
            clearTokens();
            setUser(null);
            setIsAuthenticated(false);
            toast.info('已退出登录');
        }
    };

    const hasPermission = (permission) => {
        if (!user || !user.permissions) return false;
        return user.permissions.includes(permission);
    };

    const hasRole = (role) => {
        if (!user) return false;
        return user.role === role;
    };

    const value = {
        user,
        isAuthenticated,
        loading,
        login,
        register,
        logout,
        hasPermission,
        hasRole,
        fetchCurrentUser,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
