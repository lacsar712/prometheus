import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

const clearAuthAndRedirect = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem('auth_user');
    if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
    }
};

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise(function (resolve, reject) {
                    failedQueue.push({ resolve, reject });
                })
                    .then(token => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + token;
                        return api(originalRequest);
                    })
                    .catch(err => {
                        return Promise.reject(err);
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
            if (!refreshToken) {
                clearAuthAndRedirect();
                return Promise.reject(error);
            }

            try {
                const response = await axios.post(
                    `${API_BASE_URL}/api/auth/refresh`,
                    { refresh_token: refreshToken },
                    { headers: { 'Content-Type': 'application/json' } }
                );

                const { access_token, refresh_token } = response.data;
                localStorage.setItem(TOKEN_KEY, access_token);
                localStorage.setItem(REFRESH_TOKEN_KEY, refresh_token);

                api.defaults.headers.common['Authorization'] = 'Bearer ' + access_token;
                originalRequest.headers['Authorization'] = 'Bearer ' + access_token;

                processQueue(null, access_token);
                return api(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);
                clearAuthAndRedirect();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

export const authApi = {
    login: (username, password) => {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        return api.post('/api/auth/login', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    },
    register: (data) => api.post('/api/auth/register', data),
    getMe: () => api.get('/api/auth/me'),
    logout: () => api.post('/api/auth/logout'),
    refreshToken: (refreshToken) =>
        api.post('/api/auth/refresh', { refresh_token: refreshToken }),
};

export const hiveApi = {
    list: (params) => api.get('/api/hives', { params }),
    get: (id) => api.get(`/api/hives/${id}`),
    create: (data) => api.post('/api/hives', data),
    update: (id, data) => api.put(`/api/hives/${id}`, data),
    open: (id, notes) => api.post(`/api/hives/${id}/open`, { notes }),
    harvest: (id, data) => api.post(`/api/hives/${id}/harvest`, data),
    queenChange: (id, data) => api.post(`/api/hives/${id}/queen-change`, data),
    relocate: (id, data) => api.post(`/api/hives/${id}/relocate`, data),
    retire: (id, data) => api.post(`/api/hives/${id}/retire`, data),
};

export const attachmentApi = {
    list: (hiveId, params) => api.get(`/api/hives/${hiveId}/attachments`, { params }),
    upload: (hiveId, formData, onProgress) =>
        api.post(`/api/hives/${hiveId}/attachments`, formData, {
            onUploadProgress: onProgress
                ? (progressEvent) => {
                      const percentCompleted = Math.round(
                          (progressEvent.loaded * 100) / progressEvent.total
                      );
                      onProgress(percentCompleted);
                  }
                : undefined,
        }),
    remove: (id) => api.delete(`/api/hives/attachments/${id}`),
    getDownloadUrl: (id) => `${API_BASE_URL}/api/hives/attachments/${id}/download`,
};

export const operationLogApi = {
    list: (params) => api.get('/api/operation-logs', { params }),
    get: (id) => api.get(`/api/operation-logs/${id}`),
    exportCsv: (params) =>
        api.get('/api/operation-logs/export/csv', { params, responseType: 'blob' }),
    getOperators: () => api.get('/api/operation-logs/meta/operators'),
    getOperationTypes: () => api.get('/api/operation-logs/meta/operation-types'),
};

export { api, API_BASE_URL, TOKEN_KEY, REFRESH_TOKEN_KEY, clearAuthAndRedirect };
export default api;
