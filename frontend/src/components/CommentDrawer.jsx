import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X,
    Heart,
    Send,
    ThumbsUp,
    Trash2,
    Reply,
    Clock,
    TrendingUp,
    AtSign,
    Eye,
    Edit3,
    ChevronDown,
    ChevronUp,
    MessageCircle,
} from 'lucide-react';
import { commentApi, likeApi, userApi } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'react-toastify';

function formatDateTime(dt) {
    if (!dt) return '';
    const date = new Date(dt);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
}

function simpleMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-700 px-1 rounded text-amber-400">$1</code>');
    html = html.replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold text-white mt-2 mb-1">$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold text-white mt-3 mb-2">$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold text-white mt-3 mb-2">$1</h1>');
    html = html.replace(/^\- (.*$)/gm, '<li class="ml-4 text-slate-300">$1</li>');
    html = html.replace(/^\d+\. (.*$)/gm, '<li class="ml-4 text-slate-300 list-decimal">$1</li>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blue-400 hover:underline">$1</a>');
    html = html.replace(/@(\w+)/g, '<span class="text-blue-400 bg-blue-500/10 px-1 rounded">@$1</span>');
    html = html.replace(/\n/g, '<br />');

    return html;
}

const ROLE_COLORS = {
    farm_owner: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    beekeeper: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    technician: 'bg-green-500/20 text-green-400 border-green-500/30',
    auditor: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
};

function CommentItem({ comment, onReply, onDelete, onLike, currentUser, isNested = false }) {
    const [showReplies, setShowReplies] = useState(true);
    const [isLiked, setIsLiked] = useState(comment.is_liked);
    const [likeCount, setLikeCount] = useState(comment.like_count);
    const [likeAnimating, setLikeAnimating] = useState(false);

    const handleLike = async (e) => {
        e.stopPropagation();
        if (likeAnimating) return;

        setLikeAnimating(true);
        try {
            const response = await commentApi.toggleLike(comment.id);
            setIsLiked(response.data.is_liked);
            setLikeCount(response.data.like_count);
            if (response.data.action === 'liked') {
                setLikeAnimating(true);
                setTimeout(() => setLikeAnimating(false), 300);
            }
        } catch (error) {
            toast.error('操作失败');
        } finally {
            setLikeAnimating(false);
        }
    };

    const handleDelete = async (e) => {
        e.stopPropagation();
        if (!window.confirm('确定要删除这条评论吗？')) return;

        try {
            await commentApi.remove(comment.id);
            toast.success('删除成功');
            onDelete(comment.id);
        } catch (error) {
            toast.error('删除失败');
        }
    };

    const canDelete = currentUser?.id === comment.author_id || currentUser?.role === 'farm_owner';

    if (comment.is_deleted) {
        return (
            <div className={`${isNested ? 'ml-6 pl-4 border-l-2 border-slate-700' : ''} py-3`}>
                <div className="bg-slate-800/30 rounded-xl p-3 text-slate-500 text-sm italic">
                    该评论已被删除
                </div>
            </div>
        );
    }

    return (
        <div className={`${isNested ? 'ml-6 pl-4 border-l-2 border-slate-700' : ''} py-3`}>
            <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm shrink-0">
                    {comment.author_username?.charAt(0)?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white">{comment.author_username}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs border ${ROLE_COLORS[comment.author_role] || 'bg-slate-500/20 text-slate-400'}`}>
                            {comment.author_role_name}
                        </span>
                        {comment.reply_to_username && (
                            <span className="text-slate-500 text-sm">
                                回复 <span className="text-blue-400">@{comment.reply_to_username}</span>
                            </span>
                        )}
                        <span className="text-slate-500 text-xs">{formatDateTime(comment.created_at)}</span>
                    </div>

                    <div
                        className="mt-2 text-slate-300 text-sm leading-relaxed prose prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: simpleMarkdown(comment.content) }}
                    />

                    <div className="flex items-center gap-4 mt-2">
                        <button
                            onClick={handleLike}
                            className={`flex items-center gap-1 text-xs transition-all ${
                                isLiked ? 'text-red-400' : 'text-slate-500 hover:text-red-400'
                            }`}
                        >
                            <ThumbsUp
                                className={`w-4 h-4 transition-transform ${
                                    likeAnimating ? 'scale-125' : ''
                                } ${isLiked ? 'fill-current' : ''}`}
                            />
                            <span>{likeCount}</span>
                        </button>
                        <button
                            onClick={() => onReply(comment)}
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors"
                        >
                            <Reply className="w-4 h-4" />
                            <span>回复</span>
                        </button>
                        {canDelete && (
                            <button
                                onClick={handleDelete}
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                                <span>删除</span>
                            </button>
                        )}
                    </div>

                    {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-2">
                            <button
                                onClick={() => setShowReplies(!showReplies)}
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-400 transition-colors mb-2"
                            >
                                {showReplies ? (
                                    <ChevronUp className="w-4 h-4" />
                                ) : (
                                    <ChevronDown className="w-4 h-4" />
                                )}
                                <span>{showReplies ? '收起' : '展开'} {comment.replies.length} 条回复</span>
                            </button>
                            {showReplies && (
                                <div>
                                    {comment.replies.map((reply) => (
                                        <CommentItem
                                            key={reply.id}
                                            comment={reply}
                                            onReply={onReply}
                                            onDelete={onDelete}
                                            onLike={onLike}
                                            currentUser={currentUser}
                                            isNested={true}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function CommentDrawer({ hive, isOpen, onClose }) {
    const { user } = useAuth();
    const [comments, setComments] = useState([]);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [sortBy, setSortBy] = useState('time');
    const [newComment, setNewComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [likeStatus, setLikeStatus] = useState({ like_count: 0, is_liked: false });
    const [likeLoading, setLikeLoading] = useState(false);
    const [heartAnimating, setHeartAnimating] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [mentionList, setMentionList] = useState([]);
    const [showMentionList, setShowMentionList] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
    const textareaRef = useRef(null);
    const drawerRef = useRef(null);

    const fetchComments = useCallback(async () => {
        if (!hive?.id) return;
        setCommentsLoading(true);
        try {
            const response = await commentApi.list(hive.id, sortBy);
            setComments(response.data.items);
        } catch (error) {
            toast.error('获取评论失败');
        } finally {
            setCommentsLoading(false);
        }
    }, [hive?.id, sortBy]);

    const fetchLikeStatus = useCallback(async () => {
        if (!hive?.id) return;
        try {
            const response = await likeApi.getStatus(hive.id);
            setLikeStatus(response.data);
        } catch (error) {
            // silent fail
        }
    }, [hive?.id]);

    const fetchMentionList = useCallback(async () => {
        try {
            const response = await userApi.getMentionList();
            setMentionList(response.data);
        } catch (error) {
            // silent fail
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            fetchComments();
            fetchLikeStatus();
            fetchMentionList();
        }
    }, [isOpen, fetchComments, fetchLikeStatus, fetchMentionList]);

    useEffect(() => {
        if (isOpen) {
            fetchComments();
        }
    }, [sortBy, isOpen, fetchComments]);

    const handleSubmit = async () => {
        if (!newComment.trim()) {
            toast.warning('请输入评论内容');
            return;
        }

        setSubmitting(true);
        try {
            const data = {
                content: newComment.trim(),
                parent_id: replyTo?.parent_id || replyTo?.id || null,
                reply_to_user_id: replyTo?.author_id || null,
            };
            await commentApi.create(hive.id, data);
            toast.success('评论发表成功');
            setNewComment('');
            setReplyTo(null);
            fetchComments();
        } catch (error) {
            toast.error('发表失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleLike = async () => {
        if (likeLoading) return;
        setLikeLoading(true);
        setHeartAnimating(true);
        try {
            const response = await likeApi.toggle(hive.id);
            setLikeStatus({
                like_count: response.data.like_count,
                is_liked: response.data.is_liked,
            });
            if (response.data.action === 'liked') {
                toast.success('点赞成功');
            }
        } catch (error) {
            toast.error('操作失败');
        } finally {
            setLikeLoading(false);
            setTimeout(() => setHeartAnimating(false), 600);
        }
    };

    const handleReply = (comment) => {
        setReplyTo(comment);
        setNewComment(`@${comment.author_username} `);
        textareaRef.current?.focus();
    };

    const handleDeleteComment = (commentId) => {
        const removeComment = (items) => {
            return items
                .filter((c) => c.id !== commentId)
                .map((c) => ({
                    ...c,
                    replies: c.replies ? removeComment(c.replies) : [],
                }));
        };
        setComments(removeComment(comments));
    };

    const handleTextareaInput = (e) => {
        const value = e.target.value;
        setNewComment(value);

        const cursorPos = e.target.selectionStart;
        const textBeforeCursor = value.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);

        if (atMatch) {
            setMentionFilter(atMatch[1]);
            setShowMentionList(true);
            const rect = textareaRef.current.getBoundingClientRect();
            const drawerRect = drawerRef.current?.getBoundingClientRect();
            setMentionPosition({
                top: rect.bottom - (drawerRect?.top || 0) + 5,
                left: rect.left - (drawerRect?.left || 0),
            });
        } else {
            setShowMentionList(false);
        }
    };

    const insertMention = (mentionUser) => {
        const cursorPos = textareaRef.current.selectionStart;
        const textBeforeCursor = newComment.substring(0, cursorPos);
        const textAfterCursor = newComment.substring(cursorPos);
        const newTextBefore = textBeforeCursor.replace(/@\w*$/, `@${mentionUser.username} `);
        const newValue = newTextBefore + textAfterCursor;
        setNewComment(newValue);
        setShowMentionList(false);
        setTimeout(() => {
            textareaRef.current.focus();
            const newPos = newTextBefore.length;
            textareaRef.current.setSelectionRange(newPos, newPos);
        }, 0);
    };

    const filteredMentionList = mentionList.filter((u) =>
        u.username.toLowerCase().includes(mentionFilter.toLowerCase()) && u.id !== user?.id
    );

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            handleSubmit();
        }
        if (e.key === 'Escape') {
            setShowMentionList(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <div
                ref={drawerRef}
                className="relative w-full max-w-lg bg-slate-900 border-l border-slate-700 flex flex-col h-full animate-slide-in-right"
                style={{
                    animation: 'slideInRight 0.3s ease-out',
                }}
            >
                <style>{`
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes heartBeat {
                        0%, 100% { transform: scale(1); }
                        25% { transform: scale(1.3); }
                        50% { transform: scale(1); }
                        75% { transform: scale(1.2); }
                    }
                    .animate-heart-beat {
                        animation: heartBeat 0.6s ease-in-out;
                    }
                `}</style>

                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-xl">
                            <MessageCircle className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">蜂友讨论</h2>
                            <p className="text-xs text-slate-400">{hive?.hive_code}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleToggleLike}
                            disabled={likeLoading}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                                likeStatus.is_liked
                                    ? 'bg-red-500/20 border border-red-500/30 text-red-400'
                                    : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-red-500/30 hover:text-red-400'
                            }`}
                        >
                            <Heart
                                className={`w-5 h-5 transition-all ${
                                    heartAnimating ? 'animate-heart-beat' : ''
                                } ${likeStatus.is_liked ? 'fill-current' : ''}`}
                            />
                            <span className="font-medium">{likeStatus.like_count}</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700/50 bg-slate-800/30">
                    <span className="text-sm text-slate-400">排序：</span>
                    <button
                        onClick={() => setSortBy('time')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                            sortBy === 'time'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        <Clock className="w-4 h-4" />
                        <span>最新</span>
                    </button>
                    <button
                        onClick={() => setSortBy('likes')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                            sortBy === 'likes'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'text-slate-400 hover:text-white'
                        }`}
                    >
                        <TrendingUp className="w-4 h-4" />
                        <span>最热</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {commentsLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                    ) : comments.length > 0 ? (
                        <div className="space-y-1">
                            {comments.map((comment) => (
                                <CommentItem
                                    key={comment.id}
                                    comment={comment}
                                    onReply={handleReply}
                                    onDelete={handleDeleteComment}
                                    onLike={() => {}}
                                    currentUser={user}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <MessageCircle className="w-12 h-12 text-slate-600 mb-3" />
                            <p className="text-slate-400">暂无评论</p>
                            <p className="text-xs text-slate-600 mt-1">来发表第一条评论吧</p>
                        </div>
                    )}
                </div>

                <div className="border-t border-slate-700 bg-slate-800/50 px-5 py-4">
                    {replyTo && (
                        <div className="flex items-center justify-between mb-3 px-3 py-2 bg-slate-700/30 rounded-lg">
                            <span className="text-sm text-slate-400">
                                回复 <span className="text-blue-400">@{replyTo.author_username}</span>
                            </span>
                            <button
                                onClick={() => {
                                    setReplyTo(null);
                                    setNewComment('');
                                }}
                                className="text-slate-500 hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                                    showPreview
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'text-slate-500 hover:text-white'
                                }`}
                            >
                                <Eye className="w-4 h-4" />
                                <span>预览</span>
                            </button>
                            <button
                                onClick={() => {
                                    setNewComment((prev) => prev + '@');
                                    textareaRef.current?.focus();
                                }}
                                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-500 hover:text-white transition-colors"
                            >
                                <AtSign className="w-4 h-4" />
                                <span>@同事</span>
                            </button>
                            <button
                                onClick={() => setNewComment((prev) => prev + '**粗体** ')}
                                className="px-2 py-1 rounded text-xs font-bold text-slate-500 hover:text-white transition-colors"
                            >
                                B
                            </button>
                            <button
                                onClick={() => setNewComment((prev) => prev + '*斜体* ')}
                                className="px-2 py-1 rounded text-xs italic text-slate-500 hover:text-white transition-colors"
                            >
                                I
                            </button>
                        </div>
                        <span className="text-xs text-slate-500">
                            {newComment.length}/2000 · Ctrl+Enter 发送
                        </span>
                    </div>

                    {showPreview && (
                        <div
                            className="mb-3 p-3 bg-slate-900/50 rounded-xl border border-slate-700 text-sm text-slate-300 min-h-[80px] max-h-[200px] overflow-y-auto"
                            dangerouslySetInnerHTML={{ __html: simpleMarkdown(newComment) || '<span class="text-slate-500 italic">预览内容将显示在这里...</span>' }}
                        />
                    )}

                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={newComment}
                            onChange={handleTextareaInput}
                            onKeyDown={handleKeyDown}
                            onBlur={() => setTimeout(() => setShowMentionList(false), 200)}
                            placeholder="分享你的见解... 支持Markdown格式，输入@可提及同事"
                            maxLength={2000}
                            className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none resize-none transition-all text-sm"
                            rows={3}
                        />

                        {showMentionList && filteredMentionList.length > 0 && (
                            <div
                                className="absolute z-10 bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-h-48 overflow-y-auto w-64"
                                style={{ bottom: '100%', left: 0, marginBottom: '8px' }}
                            >
                                {filteredMentionList.map((u) => (
                                    <button
                                        key={u.id}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            insertMention(u);
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
                                            {u.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-white truncate">{u.username}</p>
                                            <p className="text-xs text-slate-500 truncate">{u.role_name}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleSubmit}
                        disabled={submitting || !newComment.trim()}
                        className="mt-3 w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-slate-700 disabled:to-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium transition-all flex items-center justify-center gap-2 text-white"
                    >
                        {submitting ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                <span>发表评论</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
