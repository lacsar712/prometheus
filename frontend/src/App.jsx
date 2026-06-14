import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import BeehiveDetail from './pages/BeehiveDetail';
import BeehiveOperationLog from './pages/BeehiveOperationLog';
import InspectionPlan from './pages/InspectionPlan';
import SensorFlowControl from './pages/SensorFlowControl';
import ApiKeys from './pages/ApiKeys';
import RelocationMap from './pages/RelocationMap';

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <NotificationProvider>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route
                            path="/"
                            element={
                                <ProtectedRoute>
                                    <Dashboard />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/hives/:id"
                            element={
                                <ProtectedRoute>
                                    <BeehiveDetail />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/operation-logs"
                            element={
                                <ProtectedRoute>
                                    <BeehiveOperationLog />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/inspection-plans"
                            element={
                                <ProtectedRoute>
                                    <InspectionPlan />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/sensor-flow-control"
                            element={
                                <ProtectedRoute>
                                    <SensorFlowControl />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/api-keys"
                            element={
                                <ProtectedRoute>
                                    <ApiKeys />
                                </ProtectedRoute>
                            }
                        />
                        <Route
                            path="/relocation-map"
                            element={
                                <ProtectedRoute>
                                    <RelocationMap />
                                </ProtectedRoute>
                            }
                        />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </NotificationProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
