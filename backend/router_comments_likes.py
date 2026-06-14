import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy import Column, Integer, String, DateTime, Enum, Text, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import Session, relationship
from pydantic import BaseModel, Field

from main import Base, UserRole, ROLE_NAMES, get_db, require_permissions, Beehive, User

logger = logging.getLogger(__name__)

router = APIRouter()


# ========== 评论 / 点赞 数据库模型 ==========

class BeehiveComment(Base):
    __tablename__ = "beehive_comments"
    id = Column(Integer, primary_key=True, index=True)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)
    hive_code = Column(String(50), index=True, nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    author_username = Column(String(50), nullable=False)
    author_role = Column(Enum(UserRole), nullable=False)
    parent_id = Column(Integer, ForeignKey("beehive_comments.id"), nullable=True, index=True)
    reply_to_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reply_to_username = Column(String(50), nullable=True)
    content = Column(Text, nullable=False)
    like_count = Column(Integer, nullable=False, default=0)
    is_deleted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    author = relationship("User", foreign_keys=[author_id])
    parent = relationship("BeehiveComment", remote_side=[id], back_populates="replies")
    replies = relationship("BeehiveComment", back_populates="parent", cascade="all, delete-orphan")


class BeehiveLike(Base):
    __tablename__ = "beehive_likes"
    id = Column(Integer, primary_key=True, index=True)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('hive_id', 'user_id', name='_hive_user_uc'),
    )


class BeehiveCommentLike(Base):
    __tablename__ = "beehive_comment_likes"
    id = Column(Integer, primary_key=True, index=True)
    comment_id = Column(Integer, ForeignKey("beehive_comments.id"), nullable=False, index=True)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('comment_id', 'user_id', name='_comment_user_uc'),
    )


# ========== 评论 Pydantic 模型 ==========

class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000, description="评论内容，支持Markdown")
    parent_id: Optional[int] = Field(None, description="父评论ID，用于回复")
    reply_to_user_id: Optional[int] = Field(None, description="回复的目标用户ID")

class CommentLikeRequest(BaseModel):
    pass

class CommentResponse(BaseModel):
    id: int
    hive_id: int
    hive_code: str
    author_id: int
    author_username: str
    author_role: UserRole
    author_role_name: str
    parent_id: Optional[int]
    reply_to_user_id: Optional[int]
    reply_to_username: Optional[str]
    content: str
    like_count: int
    is_liked: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    replies: List["CommentResponse"] = []

    class Config:
        from_attributes = True

class CommentListResponse(BaseModel):
    items: List[CommentResponse]
    total: int
    sort_by: str

# ========== 点赞 Pydantic 模型 ==========

class LikeStatusResponse(BaseModel):
    hive_id: int
    like_count: int
    is_liked: bool

class LikeToggleResponse(BaseModel):
    hive_id: int
    like_count: int
    is_liked: bool
    action: str


# ========== 内部辅助函数 ==========

def get_comment_liked_ids(db: Session, user_id: int, hive_id: int) -> set:
    liked = db.query(BeehiveCommentLike).filter(
        BeehiveCommentLike.user_id == user_id,
        BeehiveCommentLike.hive_id == hive_id
    ).all()
    return {l.comment_id for l in liked}


def get_comment_response_model(comment: BeehiveComment, liked_ids: set) -> CommentResponse:
    if comment.is_deleted:
        return CommentResponse(
            id=comment.id,
            hive_id=comment.hive_id,
            hive_code=comment.hive_code,
            author_id=0,
            author_username="已删除",
            author_role=UserRole.BEEKEEPER,
            author_role_name="",
            parent_id=comment.parent_id,
            reply_to_user_id=None,
            reply_to_username=None,
            content="该评论已被删除",
            like_count=0,
            is_liked=False,
            is_deleted=True,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            replies=[],
        )

    return CommentResponse(
        id=comment.id,
        hive_id=comment.hive_id,
        hive_code=comment.hive_code,
        author_id=comment.author_id,
        author_username=comment.author_username,
        author_role=comment.author_role,
        author_role_name=ROLE_NAMES.get(comment.author_role, str(comment.author_role)),
        parent_id=comment.parent_id,
        reply_to_user_id=comment.reply_to_user_id,
        reply_to_username=comment.reply_to_username,
        content=comment.content,
        like_count=comment.like_count,
        is_liked=comment.id in liked_ids,
        is_deleted=False,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        replies=[],
    )


def build_comment_tree(comments: List[BeehiveComment], liked_ids: set) -> List[CommentResponse]:
    comment_map = {}
    root_comments = []

    for comment in comments:
        comment_resp = get_comment_response_model(comment, liked_ids)
        comment_map[comment.id] = comment_resp
        if comment.parent_id is None:
            root_comments.append(comment_resp)
        else:
            parent = comment_map.get(comment.parent_id)
            if parent:
                parent.replies.append(comment_resp)

    return root_comments


def sort_comments(comments: List[CommentResponse], sort_by: str) -> List[CommentResponse]:
    if sort_by == "likes":
        comments.sort(key=lambda c: (-c.like_count, c.created_at))
        for c in comments:
            if c.replies:
                c.replies.sort(key=lambda r: (-r.like_count, r.created_at))
    else:
        comments.sort(key=lambda c: c.created_at)
        for c in comments:
            if c.replies:
                c.replies.sort(key=lambda r: r.created_at)
    return comments


# ========== 蜂箱评论接口 ==========

@router.get("/api/hives/{hive_id}/comments", response_model=CommentListResponse)
async def list_hive_comments(
    hive_id: int,
    sort_by: str = "time",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取蜂箱的评论列表，支持嵌套树结构与双维度排序"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    comments = db.query(BeehiveComment).filter(
        BeehiveComment.hive_id == hive_id,
        BeehiveComment.is_deleted == False
    ).order_by(BeehiveComment.created_at.asc()).all()

    total = len(comments)
    liked_ids = get_comment_liked_ids(db, current_user.id, hive_id)
    comment_tree = build_comment_tree(comments, liked_ids)

    valid_sort = ["time", "likes"]
    if sort_by not in valid_sort:
        sort_by = "time"

    sorted_comments = sort_comments(comment_tree, sort_by)

    return CommentListResponse(
        items=sorted_comments,
        total=total,
        sort_by=sort_by,
    )


@router.post("/api/hives/{hive_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_hive_comment(
    hive_id: int,
    comment_data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """发表评论或二级回复"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    reply_to_user = None
    reply_to_username = None

    if comment_data.parent_id:
        parent_comment = db.query(BeehiveComment).filter(
            BeehiveComment.id == comment_data.parent_id,
            BeehiveComment.hive_id == hive_id,
            BeehiveComment.is_deleted == False
        ).first()
        if not parent_comment:
            raise HTTPException(status_code=404, detail="父评论不存在")

        if comment_data.reply_to_user_id:
            reply_to_user = db.query(User).filter(User.id == comment_data.reply_to_user_id).first()
            if reply_to_user:
                reply_to_username = reply_to_user.username

    comment = BeehiveComment(
        hive_id=hive.id,
        hive_code=hive.hive_code,
        author_id=current_user.id,
        author_username=current_user.username,
        author_role=current_user.role,
        parent_id=comment_data.parent_id,
        reply_to_user_id=comment_data.reply_to_user_id,
        reply_to_username=reply_to_username,
        content=comment_data.content.strip(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db.add(comment)
    db.commit()
    db.refresh(comment)

    logger.info(f"Comment created by {current_user.username} for hive {hive.hive_code}: comment_id={comment.id}")

    liked_ids = get_comment_liked_ids(db, current_user.id, hive_id)
    return get_comment_response_model(comment, liked_ids)


@router.delete("/api/hives/comments/{comment_id}")
async def delete_hive_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    """删除评论（仅作者本人可删，软删除）"""
    comment = db.query(BeehiveComment).filter(BeehiveComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    if comment.author_id != current_user.id and current_user.role != UserRole.FARM_OWNER:
        raise HTTPException(status_code=403, detail="无权限删除他人的评论")

    comment.is_deleted = True
    comment.updated_at = datetime.utcnow()
    db.commit()

    logger.info(f"Comment {comment_id} deleted by {current_user.username}")

    return {"message": "删除成功", "id": comment_id}


@router.post("/api/hives/comments/{comment_id}/like")
async def toggle_comment_like(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """评论点赞/取消点赞"""
    comment = db.query(BeehiveComment).filter(
        BeehiveComment.id == comment_id,
        BeehiveComment.is_deleted == False
    ).first()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    existing_like = db.query(BeehiveCommentLike).filter(
        BeehiveCommentLike.comment_id == comment_id,
        BeehiveCommentLike.user_id == current_user.id
    ).first()

    if existing_like:
        db.delete(existing_like)
        comment.like_count = max(0, comment.like_count - 1)
        action = "unliked"
        is_liked = False
    else:
        new_like = BeehiveCommentLike(
            comment_id=comment_id,
            hive_id=comment.hive_id,
            user_id=current_user.id,
            created_at=datetime.utcnow(),
        )
        db.add(new_like)
        comment.like_count += 1
        action = "liked"
        is_liked = True

    db.commit()
    db.refresh(comment)

    return {
        "comment_id": comment.id,
        "like_count": comment.like_count,
        "is_liked": is_liked,
        "action": action,
    }


# ========== 蜂箱点赞接口 ==========

@router.get("/api/hives/{hive_id}/like-status", response_model=LikeStatusResponse)
async def get_hive_like_status(
    hive_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取蜂箱点赞状态：点赞总数与当前用户是否已赞"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    like_count = db.query(BeehiveLike).filter(BeehiveLike.hive_id == hive_id).count()
    is_liked = db.query(BeehiveLike).filter(
        BeehiveLike.hive_id == hive_id,
        BeehiveLike.user_id == current_user.id
    ).first() is not None

    return LikeStatusResponse(
        hive_id=hive_id,
        like_count=like_count,
        is_liked=is_liked,
    )


@router.post("/api/hives/{hive_id}/toggle-like", response_model=LikeToggleResponse)
async def toggle_hive_like(
    hive_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """蜂箱点赞/取消点赞，实时返回点赞状态"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    existing_like = db.query(BeehiveLike).filter(
        BeehiveLike.hive_id == hive_id,
        BeehiveLike.user_id == current_user.id
    ).first()

    if existing_like:
        db.delete(existing_like)
        action = "unliked"
        is_liked = False
    else:
        new_like = BeehiveLike(
            hive_id=hive_id,
            user_id=current_user.id,
            created_at=datetime.utcnow(),
        )
        db.add(new_like)
        action = "liked"
        is_liked = True

    db.commit()

    like_count = db.query(BeehiveLike).filter(BeehiveLike.hive_id == hive_id).count()

    logger.info(f"Hive {hive.hive_code} {action} by {current_user.username}, total likes: {like_count}")

    return LikeToggleResponse(
        hive_id=hive_id,
        like_count=like_count,
        is_liked=is_liked,
        action=action,
    )


@router.get("/api/users/mention-list")
async def get_mention_users_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取可@的用户列表（用于评论时@同事）"""
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role.value,
            "role_name": ROLE_NAMES.get(u.role, str(u.role)),
        }
        for u in users
    ]
