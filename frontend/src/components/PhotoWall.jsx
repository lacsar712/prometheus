import { useState, useEffect, useRef, useCallback } from 'react';
import { attachmentApi } from '../utils/api';
import {
    Upload,
    X,
    Image as ImageIcon,
    Video,
    Trash2,
    ChevronLeft,
    ChevronRight,
    Calendar,
    Grid3X3,
    LayoutGrid,
    RotateCcw,
    Check,
    AlertCircle,
    Loader2,
    Download,
    ZoomIn,
} from 'lucide-react';
import { toast } from 'react-toastify';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_CONCURRENT = 3;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];
const ALLOWED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const ALLOWED_VIDEO_EXT = ['mp4', 'mov', 'avi', 'webm', 'mkv'];

function getFileExtension(filename) {
    return filename.split('.').pop()?.toLowerCase() || '';
}

function isImageFile(file) {
    if (file.type && ALLOWED_IMAGE_TYPES.includes(file.type)) return true;
    const ext = getFileExtension(file.name);
    return ALLOWED_IMAGE_EXT.includes(ext);
}

function isVideoFile(file) {
    if (file.type && ALLOWED_VIDEO_TYPES.includes(file.type)) return true;
    const ext = getFileExtension(file.name);
    return ALLOWED_VIDEO_EXT.includes(ext);
}

function validateFile(file) {
    if (!isImageFile(file) && !isVideoFile(file)) {
        return { valid: false, error: '不支持的文件类型，仅支持图片和视频文件' };
    }
    if (file.size > MAX_FILE_SIZE) {
        return { valid: false, error: '文件大小超过 10MB 限制' };
    }
    if (file.size === 0) {
        return { valid: false, error: '文件不能为空' };
    }
    return { valid: true };
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMonth(monthStr) {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    return `${year}年${parseInt(month)}月`;
}

function PhotoWall({ hiveId, hiveCode }) {
    const [attachments, setAttachments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(24);
    const [months, setMonths] = useState([]);
    const [selectedMonth, setSelectedMonth] = useState('');
    const [viewMode, setViewMode] = useState('grid');

    const [isDragging, setIsDragging] = useState(false);
    const [uploadQueue, setUploadQueue] = useState([]);
    const [activeUploads, setActiveUploads] = useState(0);
    const [showUploadPanel, setShowUploadPanel] = useState(false);

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);

    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    const fileInputRef = useRef(null);
    const uploadQueueRef = useRef([]);
    const activeUploadsRef = useRef(0);

    const fetchAttachments = useCallback(async () => {
        if (!hiveId) return;
        setLoading(true);
        try {
            const params = {
                page,
                size: pageSize,
            };
            if (selectedMonth) {
                params.month = selectedMonth;
            }
            const response = await attachmentApi.list(hiveId, params);
            setAttachments(response.data.items);
            setTotal(response.data.total);
            setMonths(response.data.months || []);
        } catch (error) {
            if (error.response?.status !== 403) {
                toast.error('获取附件列表失败');
            }
        } finally {
            setLoading(false);
        }
    }, [hiveId, page, pageSize, selectedMonth]);

    useEffect(() => {
        if (hiveId) {
            fetchAttachments();
        }
    }, [hiveId, fetchAttachments]);

    useEffect(() => {
        if (hiveId) {
            setPage(1);
        }
    }, [hiveId, selectedMonth]);

    const processQueue = useCallback(async () => {
        if (activeUploadsRef.current >= MAX_CONCURRENT) return;
        if (uploadQueueRef.current.length === 0) return;

        const pendingIndex = uploadQueueRef.current.findIndex((u) => u.status === 'pending');
        if (pendingIndex === -1) return;

        const uploadItem = uploadQueueRef.current[pendingIndex];
        activeUploadsRef.current += 1;
        setActiveUploads(activeUploadsRef.current);

        uploadItem.status = 'uploading';
        setUploadQueue([...uploadQueueRef.current]);

        try {
            const formData = new FormData();
            formData.append('file', uploadItem.file);
            if (uploadItem.description) {
                formData.append('description', uploadItem.description);
            }

            await attachmentApi.upload(hiveId, formData, (progress) => {
                uploadItem.progress = progress;
                setUploadQueue([...uploadQueueRef.current]);
            });

            uploadItem.status = 'success';
            uploadItem.progress = 100;
        } catch (error) {
            uploadItem.status = 'failed';
            uploadItem.error = error.response?.data?.detail || '上传失败';
        } finally {
            activeUploadsRef.current -= 1;
            setActiveUploads(activeUploadsRef.current);
            setUploadQueue([...uploadQueueRef.current]);

            const allDone = uploadQueueRef.current.every(
                (u) => u.status === 'success' || u.status === 'failed'
            );
            if (allDone) {
                const successCount = uploadQueueRef.current.filter((u) => u.status === 'success').length;
                const failCount = uploadQueueRef.current.filter((u) => u.status === 'failed').length;
                if (successCount > 0) {
                    toast.success(`成功上传 ${successCount} 个文件`);
                    fetchAttachments();
                }
                if (failCount > 0) {
                    toast.error(`${failCount} 个文件上传失败`);
                }
            } else {
                processQueue();
            }
        }
    }, [hiveId, fetchAttachments]);

    const addFiles = useCallback(
        (files) => {
            const newItems = [];
            for (const file of files) {
                const validation = validateFile(file);
                if (!validation.valid) {
                    toast.error(`${file.name}: ${validation.error}`);
                    continue;
                }

                const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                newItems.push({
                    id,
                    file,
                    name: file.name,
                    size: file.size,
                    type: isImageFile(file) ? 'image' : 'video',
                    status: 'pending',
                    progress: 0,
                    error: null,
                    description: '',
                });
            }

            if (newItems.length > 0) {
                uploadQueueRef.current = [...uploadQueueRef.current, ...newItems];
                setUploadQueue([...uploadQueueRef.current]);
                setShowUploadPanel(true);

                for (let i = 0; i < MAX_CONCURRENT; i++) {
                    processQueue();
                }
            }
        },
        [processQueue]
    );

    const retryUpload = useCallback(
        (id) => {
            const item = uploadQueueRef.current.find((u) => u.id === id);
            if (item && item.status === 'failed') {
                item.status = 'pending';
                item.progress = 0;
                item.error = null;
                setUploadQueue([...uploadQueueRef.current]);
                processQueue();
            }
        },
        [processQueue]
    );

    const removeFromQueue = useCallback((id) => {
        uploadQueueRef.current = uploadQueueRef.current.filter((u) => u.id !== id);
        setUploadQueue([...uploadQueueRef.current]);
        if (uploadQueueRef.current.length === 0) {
            setShowUploadPanel(false);
        }
    }, []);

    const clearCompleted = useCallback(() => {
        uploadQueueRef.current = uploadQueueRef.current.filter(
            (u) => u.status === 'pending' || u.status === 'uploading'
        );
        setUploadQueue([...uploadQueueRef.current]);
        if (uploadQueueRef.current.length === 0) {
            setShowUploadPanel(false);
        }
    }, []);

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target.closest('.dropzone') === null) {
            setIsDragging(false);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) {
            addFiles(files);
        }
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            addFiles(files);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDelete = async (attachment) => {
        setDeletingId(attachment.id);
        try {
            await attachmentApi.remove(attachment.id);
            setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
            setTotal((prev) => prev - 1);
            toast.success('删除成功');
            setDeleteConfirm(null);
        } catch (error) {
            toast.error(error.response?.data?.detail || '删除失败');
        } finally {
            setDeletingId(null);
        }
    };

    const openLightbox = (index) => {
        setCurrentIndex(index);
        setLightboxOpen(true);
    };

    const closeLightbox = () => {
        setLightboxOpen(false);
    };

    const prevImage = () => {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : attachments.length - 1));
    };

    const nextImage = () => {
        setCurrentIndex((prev) => (prev < attachments.length - 1 ? prev + 1 : 0));
    };

    const totalPages = Math.ceil(total / pageSize);

    const currentAttachment = attachments[currentIndex];

    const groupByMonth = (items) => {
        const groups = {};
        for (const item of items) {
            let monthKey = '未分类';
            if (item.shot_at) {
                const date = new Date(item.shot_at);
                monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }
            if (!groups[monthKey]) {
                groups[monthKey] = [];
            }
            groups[monthKey].push(item);
        }
        return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
    };

    const renderMasonry = (items) => {
        const columns = [[], [], []];
        const columnHeights = [0, 0, 0];

        for (const item of items) {
            const shortestCol = columnHeights.indexOf(Math.min(...columnHeights));
            columns[shortestCol].push(item);
            columnHeights[shortestCol] += item.media_type === 'video' ? 1.2 : 1;
        }

        return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {columns.map((column, colIndex) => (
                    <div key={colIndex} className="flex flex-col gap-3">
                        {column.map((item, idx) => (
                            <PhotoCard
                                key={item.id}
                                item={item}
                                onClick={() => {
                                    const flatIndex = attachments.findIndex((a) => a.id === item.id);
                                    openLightbox(flatIndex);
                                }}
                                onDelete={() => setDeleteConfirm(item)}
                                deleting={deletingId === item.id}
                            />
                        ))}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
                    >
                        <Upload className="w-4 h-4" />
                        上传照片/视频
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        onChange={handleFileSelect}
                        className="hidden"
                    />

                    {uploadQueue.length > 0 && (
                        <button
                            onClick={() => setShowUploadPanel(!showUploadPanel)}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-xl text-sm transition-colors"
                        >
                            <Loader2 className={`w-4 h-4 ${activeUploads > 0 ? 'animate-spin' : ''}`} />
                            上传队列 ({uploadQueue.length})
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded ${
                                viewMode === 'grid'
                                    ? 'bg-slate-700 text-white'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Grid3X3 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('month')}
                            className={`p-1.5 rounded ${
                                viewMode === 'month'
                                    ? 'bg-slate-700 text-white'
                                    : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            <Calendar className="w-4 h-4" />
                        </button>
                    </div>

                    {months.length > 0 && (
                        <select
                            value={selectedMonth}
                            onChange={(e) => {
                                setSelectedMonth(e.target.value);
                                setPage(1);
                            }}
                            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                        >
                            <option value="">全部月份</option>
                            {months.map((m) => (
                                <option key={m} value={m}>
                                    {formatMonth(m)}
                                </option>
                            ))}
                        </select>
                    )}

                    <span className="text-sm text-slate-400">
                        共 <span className="text-white font-medium">{total}</span> 个文件
                    </span>
                </div>
            </div>

            <div
                className={`dropzone relative border-2 border-dashed rounded-2xl p-8 mb-6 transition-all ${
                    isDragging
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-700 bg-slate-800/30 hover:border-slate-600'
                }`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="flex flex-col items-center justify-center text-center cursor-pointer">
                    <div className="w-14 h-14 rounded-2xl bg-slate-700/50 flex items-center justify-center mb-3">
                        <Upload className="w-7 h-7 text-slate-400" />
                    </div>
                    <p className="text-slate-300 font-medium mb-1">
                        {isDragging ? '松开鼠标上传文件' : '拖拽文件到此处，或点击选择'}
                    </p>
                    <p className="text-sm text-slate-500">
                        支持 JPG、PNG、MP4 等格式，单文件不超过 10MB
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
            ) : attachments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-4">
                        <ImageIcon className="w-10 h-10 text-slate-600" />
                    </div>
                    <p className="text-slate-400 mb-1">暂无照片和视频</p>
                    <p className="text-sm text-slate-600">上传第一张照片开始记录蜂箱状态</p>
                </div>
            ) : viewMode === 'grid' ? (
                renderMasonry(attachments)
            ) : (
                <div className="space-y-6">
                    {groupByMonth(attachments).map(([month, items]) => (
                        <div key={month}>
                            <div className="flex items-center gap-2 mb-3">
                                <Calendar className="w-4 h-4 text-amber-400" />
                                <h3 className="text-white font-medium">
                                    {month === '未分类' ? month : formatMonth(month)}
                                </h3>
                                <span className="text-sm text-slate-500">({items.length} 个)</span>
                            </div>
                            {renderMasonry(items)}
                        </div>
                    ))}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6 pt-4 border-t border-slate-700/50">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft className="w-4 h-4 text-slate-400" />
                    </button>
                    <span className="text-sm text-slate-400">
                        第 <span className="text-white">{page}</span> / {totalPages} 页
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                </div>
            )}

            {showUploadPanel && uploadQueue.length > 0 && (
                <div className="fixed bottom-4 right-4 w-80 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl z-40 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-700">
                        <div className="flex items-center gap-2">
                            <Upload className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-medium text-white">
                                上传队列 ({uploadQueue.length})
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={clearCompleted}
                                className="text-xs text-slate-400 hover:text-white transition-colors"
                            >
                                清除已完成
                            </button>
                            <button
                                onClick={() => setShowUploadPanel(false)}
                                className="p-1 rounded hover:bg-slate-700 transition-colors"
                            >
                                <X className="w-4 h-4 text-slate-400" />
                            </button>
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                        {uploadQueue.map((item) => (
                            <div
                                key={item.id}
                                className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 last:border-b-0"
                            >
                                <div className="w-10 h-10 rounded-lg bg-slate-700/50 flex items-center justify-center shrink-0">
                                    {item.type === 'image' ? (
                                        <ImageIcon className="w-5 h-5 text-slate-400" />
                                    ) : (
                                        <Video className="w-5 h-5 text-slate-400" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white truncate">{item.name}</p>
                                    <p className="text-xs text-slate-500">
                                        {formatSize(item.size)}
                                    </p>
                                    {item.status === 'uploading' && (
                                        <div className="w-full h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all"
                                                style={{ width: `${item.progress}%` }}
                                            />
                                        </div>
                                    )}
                                    {item.status === 'failed' && (
                                        <p className="text-xs text-red-400 mt-1">{item.error}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {item.status === 'success' && (
                                        <Check className="w-4 h-4 text-green-400" />
                                    )}
                                    {item.status === 'failed' && (
                                        <>
                                            <button
                                                onClick={() => retryUpload(item.id)}
                                                className="p-1.5 rounded hover:bg-slate-700 transition-colors"
                                                title="重试"
                                            >
                                                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                                            </button>
                                            <button
                                                onClick={() => removeFromQueue(item.id)}
                                                className="p-1.5 rounded hover:bg-slate-700 transition-colors"
                                                title="移除"
                                            >
                                                <X className="w-3.5 h-3.5 text-slate-400" />
                                            </button>
                                        </>
                                    )}
                                    {item.status === 'uploading' && (
                                        <span className="text-xs text-blue-400">
                                            {item.progress}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {lightboxOpen && currentAttachment && (
                <div
                    className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
                    onClick={closeLightbox}
                >
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            closeLightbox();
                        }}
                        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>

                    {attachments.length > 1 && (
                        <>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    prevImage();
                                }}
                                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                            >
                                <ChevronLeft className="w-6 h-6 text-white" />
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    nextImage();
                                }}
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                            >
                                <ChevronRight className="w-6 h-6 text-white" />
                            </button>
                        </>
                    )}

                    <div
                        className="max-w-full max-h-full p-8 flex flex-col items-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {currentAttachment.media_type === 'image' ? (
                            <img
                                src={currentAttachment.download_url}
                                alt={currentAttachment.file_name}
                                className="max-w-full max-h-[80vh] object-contain rounded-lg"
                            />
                        ) : (
                            <video
                                src={currentAttachment.download_url}
                                controls
                                className="max-w-full max-h-[80vh] rounded-lg"
                            />
                        )}

                        <div className="mt-4 text-center">
                            <p className="text-white font-medium">{currentAttachment.file_name}</p>
                            <p className="text-sm text-slate-400 mt-1">
                                {currentAttachment.file_size_human} · 上传者:{' '}
                                {currentAttachment.uploader_username}
                                {currentAttachment.shot_at &&
                                    ` · 拍摄于 ${new Date(
                                        currentAttachment.shot_at
                                    ).toLocaleDateString('zh-CN')}`}
                            </p>
                            <div className="flex items-center justify-center gap-2 mt-3">
                                <a
                                    href={currentAttachment.download_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors"
                                >
                                    <Download className="w-4 h-4" />
                                    下载
                                </a>
                                <button
                                    onClick={() => {
                                        setDeleteConfirm(currentAttachment);
                                        closeLightbox();
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    删除
                                </button>
                            </div>
                            {currentAttachment.tags &&
                                currentAttachment.tags.length > 0 && (
                                    <div className="flex items-center justify-center gap-1.5 mt-3">
                                        {currentAttachment.tags.map((tag, i) => (
                                            <span
                                                key={i}
                                                className="px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded text-xs"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                        </div>
                    </div>

                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-slate-400">
                        {currentIndex + 1} / {attachments.length}
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-96 max-w-[90vw] shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center">
                                <AlertCircle className="w-6 h-6 text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-white">确认删除</h3>
                                <p className="text-sm text-slate-400">此操作不可撤销</p>
                            </div>
                        </div>

                        <p className="text-slate-300 mb-6">
                            确定要删除文件{' '}
                            <span className="text-white font-medium">
                                "{deleteConfirm.file_name}"
                            </span>{' '}
                            吗？
                        </p>

                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                disabled={deletingId === deleteConfirm.id}
                                className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-all text-sm disabled:opacity-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                disabled={deletingId === deleteConfirm.id}
                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition-all text-sm flex items-center gap-2 disabled:opacity-50"
                            >
                                {deletingId === deleteConfirm.id ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        删除中...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        确认删除
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function PhotoCard({ item, onClick, onDelete, deleting }) {
    return (
        <div
            className="relative group rounded-xl overflow-hidden bg-slate-800/50 cursor-pointer aspect-[4/3]"
            onClick={onClick}
        >
            {item.media_type === 'image' ? (
                <img
                    src={item.thumbnail_url || item.download_url}
                    alt={item.file_name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-700/50">
                    <Video className="w-10 h-10 text-slate-500" />
                </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-white/80 truncate">{item.file_name}</p>
                    <p className="text-xs text-white/60">{item.file_size_human}</p>
                </div>
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                disabled={deleting}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 hover:bg-red-500/80 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
            >
                {deleting ? (
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                    <Trash2 className="w-4 h-4 text-white" />
                )}
            </button>

            <div className="absolute top-2 left-2 p-1.5 rounded-lg bg-black/40">
                {item.media_type === 'image' ? (
                    <ImageIcon className="w-3.5 h-3.5 text-white" />
                ) : (
                    <Video className="w-3.5 h-3.5 text-white" />
                )}
            </div>

            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <ZoomIn className="w-5 h-5 text-white" />
                </div>
            </div>
        </div>
    );
}

export default PhotoWall;
