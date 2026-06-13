import logging
import time
import random
import os
import asyncio
import json
from datetime import datetime, timedelta
from enum import Enum as PyEnum
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request, Depends, status, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Enum, Text, Float, ForeignKey, Boolean, case, UniqueConstraint, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, EmailStr, Field, validator
from fastapi.responses import StreamingResponse
import io
import csv
from passlib.context import CryptContext
import jwt

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

# 数据库配置
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/prometheus_db")
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# JWT 配置
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production-please-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# 密码加密上下文
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 方案
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# 角色枚举
class UserRole(str, PyEnum):
    FARM_OWNER = "farm_owner"      # 场主
    BEEKEEPER = "beekeeper"        # 养蜂员
    TECHNICIAN = "technician"      # 技术员
    AUDITOR = "auditor"            # 外部审计

# 角色中文名称映射
ROLE_NAMES = {
    UserRole.FARM_OWNER: "场主",
    UserRole.BEEKEEPER: "养蜂员",
    UserRole.TECHNICIAN: "技术员",
    UserRole.AUDITOR: "外部审计",
}

# 权限定义
ROLE_PERMISSIONS = {
    UserRole.FARM_OWNER: ["create", "read", "update", "delete", "audit", "manage_users"],
    UserRole.BEEKEEPER: ["create", "read", "update"],
    UserRole.TECHNICIAN: ["read", "update"],
    UserRole.AUDITOR: ["read", "audit"],
}

# 蜂箱操作类型枚举
class HiveOperationType(str, PyEnum):
    OPEN_BOX = "open_box"           # 开箱
    HARVEST = "harvest"             # 采蜜
    QUEEN_CHANGE = "queen_change"   # 换王
    RELOCATE = "relocate"           # 迁场
    RETIRE = "retire"               # 退役
    CREATE = "create"               # 新建
    UPDATE = "update"               # 更新
    INSPECTION = "inspection"       # 巡检

# 操作类型中文名称映射
OPERATION_TYPE_NAMES = {
    HiveOperationType.OPEN_BOX: "开箱",
    HiveOperationType.HARVEST: "采蜜",
    HiveOperationType.QUEEN_CHANGE: "换王",
    HiveOperationType.RELOCATE: "迁场",
    HiveOperationType.RETIRE: "退役",
    HiveOperationType.CREATE: "新建",
    HiveOperationType.UPDATE: "更新",
    HiveOperationType.INSPECTION: "巡检",
}

# 媒体类型枚举
class MediaType(str, PyEnum):
    IMAGE = "image"
    VIDEO = "video"

MEDIA_TYPE_NAMES = {
    MediaType.IMAGE: "图片",
    MediaType.VIDEO: "视频",
}

ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "bmp"}
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov", "avi", "webm", "mkv"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# 群势等级
class StrengthLevel(str, PyEnum):
    WEAK = "weak"           # 弱
    MEDIUM = "medium"       # 中
    STRONG = "strong"       # 强
    VERY_STRONG = "very_strong"  # 特强

STRENGTH_LEVEL_NAMES = {
    StrengthLevel.WEAK: "弱",
    StrengthLevel.MEDIUM: "中",
    StrengthLevel.STRONG: "强",
    StrengthLevel.VERY_STRONG: "特强",
}

# 数据库模型
class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False)
    farm_scope = Column(Text, nullable=False, default="[]")  # JSON数组存储可访问蜂场ID列表
    created_at = Column(DateTime, default=datetime.utcnow)

class Beehive(Base):
    __tablename__ = "beehives"
    id = Column(Integer, primary_key=True, index=True)
    hive_code = Column(String(50), unique=True, index=True, nullable=False)  # 蜂箱编号
    apiary_id = Column(String(100), nullable=False, default="default")  # 所属蜂场
    bee_species = Column(String(50), nullable=True)  # 蜂种
    box_type = Column(String(50), nullable=True)  # 箱型
    strength_level = Column(Enum(StrengthLevel), nullable=False, default=StrengthLevel.MEDIUM)  # 群势等级
    temperature = Column(Float, nullable=True)  # 箱内温度
    humidity = Column(Float, nullable=True)  # 箱内湿度
    weight = Column(Float, nullable=True)  # 蜂箱重量
    queen_birth_date = Column(DateTime, nullable=True)  # 蜂王出生日期
    location_lat = Column(Float, nullable=True)  # 纬度
    location_lng = Column(Float, nullable=True)  # 经度
    status = Column(String(20), nullable=False, default="active")  # active/retired
    notes = Column(Text, nullable=True)  # 备注
    created_at = Column(DateTime, default=datetime.utcnow)
    last_inspected_at = Column(DateTime, nullable=True)  # 最近巡检时间
    retired_at = Column(DateTime, nullable=True)  # 退役时间

    operation_logs = relationship("BeehiveOperationLog", back_populates="beehive")
    attachments = relationship("BeehiveAttachment", back_populates="beehive", cascade="all, delete-orphan")

class BeehiveOperationLog(Base):
    __tablename__ = "beehive_operation_logs"
    id = Column(Integer, primary_key=True, index=True)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)  # 目标蜂箱ID
    hive_code = Column(String(50), index=True, nullable=False)  # 蜂箱编号（冗余，便于查询）
    operation_type = Column(Enum(HiveOperationType), nullable=False, index=True)  # 操作类型
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 操作人ID
    operator_username = Column(String(50), nullable=False)  # 操作人用户名（冗余）
    context_data = Column(Text, nullable=False, default="{}")  # 操作时关键上下文（JSON格式，含群势、温度等）
    source_ip = Column(String(50), nullable=True)  # 来源IP
    description = Column(String(500), nullable=True)  # 操作描述
    created_at = Column(DateTime, default=datetime.utcnow, index=True)  # 操作时间

    beehive = relationship("Beehive", back_populates="operation_logs")

class BeehiveAttachment(Base):
    __tablename__ = "beehive_attachments"
    id = Column(Integer, primary_key=True, index=True)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)
    hive_code = Column(String(50), index=True, nullable=False)
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploader_username = Column(String(50), nullable=False)
    file_key = Column(String(255), unique=True, nullable=False)
    file_name = Column(String(255), nullable=False)
    media_type = Column(Enum(MediaType), nullable=False, index=True)
    file_size = Column(Integer, nullable=False)
    mime_type = Column(String(100), nullable=True)
    shot_at = Column(DateTime, nullable=True, index=True)
    tags = Column(Text, nullable=False, default="[]")
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    beehive = relationship("Beehive", back_populates="attachments")
    uploader = relationship("User")


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

# Pydantic 模型
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

class TokenData(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    role: Optional[UserRole] = None

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="用户名3-50个字符")
    password: str = Field(..., min_length=8, max_length=128, description="密码至少8位")
    confirm_password: str = Field(..., description="确认密码")
    role: UserRole = Field(..., description="用户角色")
    farm_scope: Optional[List[str]] = Field(default=None, description="可访问的蜂场范围")

    @validator('confirm_password')
    def passwords_match(cls, v, values):
        if 'password' in values and v != values['password']:
            raise ValueError('两次输入的密码不一致')
        return v

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    role_name: str
    farm_scope: List[str]
    created_at: datetime
    permissions: List[str]

    class Config:
        from_attributes = True

class RefreshTokenRequest(BaseModel):
    refresh_token: str

# ========== 蜂箱相关 Pydantic 模型 ==========
class BeehiveBase(BaseModel):
    hive_code: str = Field(..., min_length=2, max_length=50, description="蜂箱编号")
    apiary_id: str = Field(default="default", description="所属蜂场ID")
    bee_species: Optional[str] = Field(None, max_length=50, description="蜂种")
    box_type: Optional[str] = Field(None, max_length=50, description="箱型")
    strength_level: StrengthLevel = Field(default=StrengthLevel.MEDIUM, description="群势等级")
    temperature: Optional[float] = Field(None, description="箱内温度(℃)")
    humidity: Optional[float] = Field(None, description="箱内湿度(%)")
    weight: Optional[float] = Field(None, description="蜂箱重量(kg)")
    queen_birth_date: Optional[datetime] = Field(None, description="蜂王出生日期")
    location_lat: Optional[float] = Field(None, description="纬度")
    location_lng: Optional[float] = Field(None, description="经度")
    notes: Optional[str] = Field(None, max_length=1000, description="备注")

class BeehiveCreate(BeehiveBase):
    pass

class BeehiveUpdate(BaseModel):
    hive_code: Optional[str] = Field(None, min_length=2, max_length=50)
    apiary_id: Optional[str] = None
    bee_species: Optional[str] = None
    box_type: Optional[str] = None
    strength_level: Optional[StrengthLevel] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    weight: Optional[float] = None
    queen_birth_date: Optional[datetime] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None

class BeehiveResponse(BaseModel):
    id: int
    hive_code: str
    apiary_id: str
    bee_species: Optional[str]
    box_type: Optional[str]
    strength_level: StrengthLevel
    strength_level_name: str
    temperature: Optional[float]
    humidity: Optional[float]
    weight: Optional[float]
    queen_birth_date: Optional[datetime]
    location_lat: Optional[float]
    location_lng: Optional[float]
    status: str
    notes: Optional[str]
    created_at: datetime
    last_inspected_at: Optional[datetime]
    retired_at: Optional[datetime]

    class Config:
        from_attributes = True

class BeehiveListResponse(BaseModel):
    items: List[BeehiveResponse]
    total: int
    page: int
    size: int

# ========== 操作日志相关 Pydantic 模型 ==========
class OperationLogResponse(BaseModel):
    id: int
    hive_id: int
    hive_code: str
    operation_type: HiveOperationType
    operation_type_name: str
    operator_id: int
    operator_username: str
    context_data: str
    source_ip: Optional[str]
    description: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

class OperationLogListResponse(BaseModel):
    items: List[OperationLogResponse]
    total: int
    page: int
    size: int

# ========== 附件相关 Pydantic 模型 ==========
class AttachmentResponse(BaseModel):
    id: int
    hive_id: int
    hive_code: str
    uploader_id: int
    uploader_username: str
    file_key: str
    file_name: str
    media_type: MediaType
    media_type_name: str
    file_size: int
    file_size_human: str
    mime_type: Optional[str]
    shot_at: Optional[datetime]
    tags: List[str]
    description: Optional[str]
    download_url: str
    thumbnail_url: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

class AttachmentListResponse(BaseModel):
    items: List[AttachmentResponse]
    total: int
    page: int
    size: int
    months: List[str] = []

class AttachmentUploadResponse(BaseModel):
    id: int
    file_name: str
    media_type: MediaType
    file_size: int
    message: str

# ========== 评论相关 Pydantic 模型 ==========
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

# ========== 点赞相关 Pydantic 模型 ==========
class LikeStatusResponse(BaseModel):
    hive_id: int
    like_count: int
    is_liked: bool

class LikeToggleResponse(BaseModel):
    hive_id: int
    like_count: int
    is_liked: bool
    action: str

# ========== 操作请求模型 ==========
class OpenBoxRequest(BaseModel):
    notes: Optional[str] = None

class HarvestRequest(BaseModel):
    harvest_kg: float = Field(..., gt=0, description="采蜜重量(kg)")
    notes: Optional[str] = None

class QueenChangeRequest(BaseModel):
    new_queen_code: str = Field(..., description="新蜂王编号")
    old_queen_reason: Optional[str] = Field(None, description="换王原因")
    notes: Optional[str] = None

class RelocateRequest(BaseModel):
    target_apiary: str = Field(..., description="目标蜂场")
    reason: Optional[str] = Field(None, description="迁场原因")
    notes: Optional[str] = None

class RetireRequest(BaseModel):
    reason: Optional[str] = Field(None, description="退役原因")
    notes: Optional[str] = None

# 工具函数
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的Token",
            headers={"WWW-Authenticate": "Bearer"},
        )

def parse_farm_scope(farm_scope_str: str) -> List[str]:
    try:
        return json.loads(farm_scope_str)
    except (json.JSONDecodeError, TypeError):
        return []

def get_user_response_model(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        role_name=ROLE_NAMES.get(user.role, str(user.role)),
        farm_scope=parse_farm_scope(user.farm_scope),
        created_at=user.created_at,
        permissions=ROLE_PERMISSIONS.get(user.role, []),
    )

def get_beehive_response_model(hive: Beehive) -> BeehiveResponse:
    return BeehiveResponse(
        id=hive.id,
        hive_code=hive.hive_code,
        apiary_id=hive.apiary_id,
        bee_species=hive.bee_species,
        box_type=hive.box_type,
        strength_level=hive.strength_level,
        strength_level_name=STRENGTH_LEVEL_NAMES.get(hive.strength_level, str(hive.strength_level)),
        temperature=hive.temperature,
        humidity=hive.humidity,
        weight=hive.weight,
        queen_birth_date=hive.queen_birth_date,
        location_lat=hive.location_lat,
        location_lng=hive.location_lng,
        status=hive.status,
        notes=hive.notes,
        created_at=hive.created_at,
        last_inspected_at=hive.last_inspected_at,
        retired_at=hive.retired_at,
    )

def get_operation_log_response_model(log: BeehiveOperationLog) -> OperationLogResponse:
    return OperationLogResponse(
        id=log.id,
        hive_id=log.hive_id,
        hive_code=log.hive_code,
        operation_type=log.operation_type,
        operation_type_name=OPERATION_TYPE_NAMES.get(log.operation_type, str(log.operation_type)),
        operator_id=log.operator_id,
        operator_username=log.operator_username,
        context_data=log.context_data,
        source_ip=log.source_ip,
        description=log.description,
        created_at=log.created_at,
    )

def get_hive_context_data(hive: Beehive) -> dict:
    return {
        "strength_level": hive.strength_level.value if hive.strength_level else None,
        "strength_level_name": STRENGTH_LEVEL_NAMES.get(hive.strength_level, str(hive.strength_level)) if hive.strength_level else None,
        "temperature": hive.temperature,
        "humidity": hive.humidity,
        "weight": hive.weight,
        "bee_species": hive.bee_species,
        "box_type": hive.box_type,
        "apiary_id": hive.apiary_id,
        "status": hive.status,
        "queen_birth_date": hive.queen_birth_date.isoformat() if hive.queen_birth_date else None,
    }

def create_operation_log(
    db: Session,
    hive: Beehive,
    operation_type: HiveOperationType,
    operator: User,
    source_ip: Optional[str] = None,
    description: Optional[str] = None,
    extra_context: Optional[dict] = None,
) -> BeehiveOperationLog:
    context = get_hive_context_data(hive)
    if extra_context:
        context.update(extra_context)

    log = BeehiveOperationLog(
        hive_id=hive.id,
        hive_code=hive.hive_code,
        operation_type=operation_type,
        operator_id=operator.id,
        operator_username=operator.username,
        context_data=json.dumps(context, ensure_ascii=False),
        source_ip=source_ip,
        description=description,
        created_at=datetime.utcnow(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

# ========== MinIO 对象存储服务 ==========
from minio import Minio
from minio.error import S3Error

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin123")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "beehive-attachments")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
PRESIGNED_URL_EXPIRY = 3600  # 1小时

_minio_client = None

def get_minio_client() -> Minio:
    global _minio_client
    if _minio_client is None:
        _minio_client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )
    return _minio_client

def init_minio_bucket():
    try:
        client = get_minio_client()
        if not client.bucket_exists(MINIO_BUCKET):
            client.make_bucket(MINIO_BUCKET)
            logger.info(f"MinIO bucket '{MINIO_BUCKET}' created.")
        else:
            logger.info(f"MinIO bucket '{MINIO_BUCKET}' already exists.")
    except Exception as e:
        logger.error(f"Failed to initialize MinIO bucket: {e}")

def get_file_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

def detect_media_type(filename: str) -> Optional[MediaType]:
    ext = get_file_extension(filename)
    if ext in ALLOWED_IMAGE_EXTENSIONS:
        return MediaType.IMAGE
    if ext in ALLOWED_VIDEO_EXTENSIONS:
        return MediaType.VIDEO
    return None

def generate_file_key(hive_code: str, media_type: MediaType, filename: str) -> str:
    import uuid
    ext = get_file_extension(filename)
    unique_id = uuid.uuid4().hex[:12]
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"{hive_code}/{media_type.value}/{timestamp}_{unique_id}.{ext}"

def human_readable_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"

def get_presigned_download_url(file_key: str) -> str:
    try:
        client = get_minio_client()
        url = client.presigned_get_object(MINIO_BUCKET, file_key, expires=PRESIGNED_URL_EXPIRY)
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {file_key}: {e}")
        return ""

def parse_tags(tags_str: Optional[str]) -> List[str]:
    if not tags_str:
        return []
    try:
        return json.loads(tags_str)
    except (json.JSONDecodeError, TypeError):
        return []

def get_attachment_response_model(att: BeehiveAttachment) -> AttachmentResponse:
    download_url = get_presigned_download_url(att.file_key)
    thumbnail_url = download_url if att.media_type == MediaType.IMAGE else None
    return AttachmentResponse(
        id=att.id,
        hive_id=att.hive_id,
        hive_code=att.hive_code,
        uploader_id=att.uploader_id,
        uploader_username=att.uploader_username,
        file_key=att.file_key,
        file_name=att.file_name,
        media_type=att.media_type,
        media_type_name=MEDIA_TYPE_NAMES.get(att.media_type, str(att.media_type)),
        file_size=att.file_size,
        file_size_human=human_readable_size(att.file_size),
        mime_type=att.mime_type,
        shot_at=att.shot_at,
        tags=parse_tags(att.tags),
        description=att.description,
        download_url=download_url,
        thumbnail_url=thumbnail_url,
        created_at=att.created_at,
    )


def get_comment_liked_ids(db: Session, user_id: int, hive_id: int) -> set:
    liked = db.query(BeehiveCommentLike).filter(
        BeehiveCommentLike.user_id == user_id,
        BeehiveCommentLike.hive_id == hive_id
    ).all()
    return {l.comment_id for l in liked}


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

# 依赖项：获取当前登录用户
async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证凭证",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token类型不正确",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user_id: Optional[int] = payload.get("user_id")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token中缺少用户信息",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token验证失败",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

# 权限检查依赖项
def require_permissions(required_permissions: List[str]):
    def permission_checker(current_user: User = Depends(get_current_user)) -> User:
        user_permissions = ROLE_PERMISSIONS.get(current_user.role, [])
        for perm in required_permissions:
            if perm not in user_permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"缺少必要权限: {perm}",
                )
        return current_user
    return permission_checker

# 初始化数据库
def init_db():
    # 尝试连接并在失败时重试，适用于 Docker Compose 启动顺序
    retries = 5
    while retries > 0:
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("Database tables created successfully.")
            break
        except Exception as e:
            logger.error(f"Database connection failed: {e}. Retrying in 5 seconds...")
            retries -= 1
            time.sleep(5)

# 初始化 MinIO
def init_storage():
    retries = 5
    while retries > 0:
        try:
            init_minio_bucket()
            break
        except Exception as e:
            logger.error(f"MinIO initialization failed: {e}. Retrying in 5 seconds...")
            retries -= 1
            time.sleep(5)

app = FastAPI(title="FastAPI Prometheus Demo")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 依赖项：获取数据库会话
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Prometheus 监控配置
instrumentator = Instrumentator(
    should_group_status_codes=False,
    should_ignore_untemplated=True,
    should_respect_env_var=True,
    excluded_handlers=[".*admin.*", "/metrics"],
    env_var_name="ENABLE_METRICS",
)
instrumentator.instrument(app).expose(app)

@app.on_event("startup")
async def startup_event():
    init_db()
    init_storage()
    logger.info("Application started.")

@app.get("/")
async def root():
    return {"message": "Welcome to FastAPI Prometheus Demo API"}

# ============ 认证相关路由 ============

@app.post("/api/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: Session = Depends(get_db)):
    """用户注册"""
    db_user = db.query(User).filter(User.username == user_data.username).first()
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已被使用",
        )

    hashed_password = get_password_hash(user_data.password)
    farm_scope_json = json.dumps(user_data.farm_scope or [], ensure_ascii=False)

    new_user = User(
        username=user_data.username,
        hashed_password=hashed_password,
        role=user_data.role,
        farm_scope=farm_scope_json,
        created_at=datetime.utcnow(),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    logger.info(f"New user registered: {new_user.username} ({new_user.role})")

    access_token = create_access_token(
        data={"user_id": new_user.id, "username": new_user.username, "role": new_user.role.value}
    )
    refresh_token = create_refresh_token(
        data={"user_id": new_user.id, "username": new_user.username}
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

@app.post("/api/auth/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """用户登录"""
    db_user = db.query(User).filter(User.username == form_data.username).first()
    if not db_user or not verify_password(form_data.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info(f"User logged in: {db_user.username} ({db_user.role})")

    access_token = create_access_token(
        data={"user_id": db_user.id, "username": db_user.username, "role": db_user.role.value}
    )
    refresh_token = create_refresh_token(
        data={"user_id": db_user.id, "username": db_user.username}
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

@app.post("/api/auth/refresh", response_model=Token)
async def refresh_token(request: RefreshTokenRequest, db: Session = Depends(get_db)):
    """刷新访问凭证"""
    try:
        payload = decode_token(request.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token类型不正确",
            )
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token中缺少用户信息",
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的刷新凭证",
        )

    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )

    logger.info(f"Token refreshed for user: {db_user.username}")

    access_token = create_access_token(
        data={"user_id": db_user.id, "username": db_user.username, "role": db_user.role.value}
    )
    new_refresh_token = create_refresh_token(
        data={"user_id": db_user.id, "username": db_user.username}
    )

    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

@app.get("/api/auth/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return get_user_response_model(current_user)

@app.post("/api/auth/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """用户退出登录（前端清除Token即可，此接口用于审计日志）"""
    logger.info(f"User logged out: {current_user.username}")
    return {"message": "退出登录成功"}

# ============ 业务接口（需认证） ============

@app.get("/api/success")
async def success_endpoint(current_user: User = Depends(get_current_user)):
    """模拟成功的请求（需认证）"""
    logger.info(f"Success endpoint called by {current_user.username}")
    return {"status": "success", "data": "Hello World"}

@app.get("/api/slow")
async def slow_endpoint(current_user: User = Depends(get_current_user)):
    """模拟耗时较长的请求（需认证）"""
    delay = random.uniform(0.5, 2.0)
    logger.info(f"Slow endpoint called by {current_user.username}, sleeping for {delay:.2f}s")
    await asyncio.sleep(delay)
    return {"status": "success", "delay": delay}

@app.get("/api/error")
async def error_endpoint(current_user: User = Depends(get_current_user)):
    """模拟故障的请求（需认证）"""
    logger.error(f"Error endpoint called by {current_user.username} - simulating 500 failure")
    raise HTTPException(status_code=500, detail="Simulated Internal Server Error")

@app.get("/api/items")
async def read_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"]))
):
    """从数据库读取数据（需read权限）"""
    logger.info(f"Items read by {current_user.username}")
    items = db.query(Item).all()
    return items

@app.post("/api/items")
async def create_item(
    name: str,
    description: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"]))
):
    """向数据库写入数据（需create权限）"""
    db_item = Item(name=name, description=description)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    logger.info(f"Item created by {current_user.username}: {db_item.name}")
    return db_item

# ============ 蜂箱档案接口 ============

@app.get("/api/hives", response_model=BeehiveListResponse)
async def list_beehives(
    page: int = 1,
    size: int = 20,
    keyword: Optional[str] = None,
    apiary_id: Optional[str] = None,
    strength_in: Optional[str] = None,
    status: Optional[str] = None,
    order_by: str = "created_at",
    order_dir: str = "desc",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"]))
):
    """分页查询蜂箱列表"""
    query = db.query(Beehive)

    if keyword:
        query = query.filter(
            (Beehive.hive_code.ilike(f"%{keyword}%")) |
            (Beehive.notes.ilike(f"%{keyword}%"))
        )
    if apiary_id:
        query = query.filter(Beehive.apiary_id == apiary_id)
    if strength_in:
        levels = [s.strip() for s in strength_in.split(",") if s.strip()]
        if levels:
            query = query.filter(Beehive.strength_level.in_(levels))
    if status:
        query = query.filter(Beehive.status == status)

    total = query.count()

    valid_order_fields = ["id", "hive_code", "created_at", "last_inspected_at", "strength_level"]
    if order_by not in valid_order_fields:
        order_by = "created_at"
    if order_dir.lower() == "asc":
        query = query.order_by(getattr(Beehive, order_by).asc())
    else:
        query = query.order_by(getattr(Beehive, order_by).desc())

    offset = (page - 1) * size
    items = query.offset(offset).limit(size).all()

    return BeehiveListResponse(
        items=[get_beehive_response_model(h) for h in items],
        total=total,
        page=page,
        size=size,
    )

@app.get("/api/hives/{hive_id}", response_model=BeehiveResponse)
async def get_beehive(
    hive_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"]))
):
    """获取单个蜂箱详情"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    return get_beehive_response_model(hive)

@app.post("/api/hives", response_model=BeehiveResponse, status_code=status.HTTP_201_CREATED)
async def create_beehive(
    hive_data: BeehiveCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"]))
):
    """新建蜂箱（自动记录操作日志）"""
    existing = db.query(Beehive).filter(Beehive.hive_code == hive_data.hive_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="蜂箱编号已存在")

    hive = Beehive(**hive_data.model_dump())
    db.add(hive)
    db.flush()

    create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.CREATE,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=f"新建蜂箱 {hive.hive_code}",
    )

    db.commit()
    db.refresh(hive)
    logger.info(f"Beehive created by {current_user.username}: {hive.hive_code}")
    return get_beehive_response_model(hive)

@app.put("/api/hives/{hive_id}", response_model=BeehiveResponse)
async def update_beehive(
    hive_id: int,
    update_data: BeehiveUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"]))
):
    """更新蜂箱信息（自动记录操作日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    update_dict = update_data.model_dump(exclude_unset=True)
    if not update_dict:
        return get_beehive_response_model(hive)

    if "hive_code" in update_dict and update_dict["hive_code"] != hive.hive_code:
        existing = db.query(Beehive).filter(Beehive.hive_code == update_dict["hive_code"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="蜂箱编号已存在")

    changed_fields = []
    for key, value in update_dict.items():
        if hasattr(hive, key):
            old_val = getattr(hive, key)
            if old_val != value:
                changed_fields.append(key)
            setattr(hive, key, value)

    if changed_fields:
        create_operation_log(
            db=db,
            hive=hive,
            operation_type=HiveOperationType.UPDATE,
            operator=current_user,
            source_ip=get_client_ip(request),
            description=f"更新蜂箱信息，变更字段: {', '.join(changed_fields)}",
            extra_context={"changed_fields": changed_fields},
        )

    db.commit()
    db.refresh(hive)
    logger.info(f"Beehive updated by {current_user.username}: {hive.hive_code}")
    return get_beehive_response_model(hive)

# ============ 蜂箱操作接口（均自动记录审计日志） ============

@app.post("/api/hives/{hive_id}/open", response_model=OperationLogResponse)
async def open_beehive(
    hive_id: int,
    req_data: OpenBoxRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"]))
):
    """开箱操作（自动记录审计日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    if hive.status != "active":
        raise HTTPException(status_code=400, detail="蜂箱已退役，无法操作")

    hive.last_inspected_at = datetime.utcnow()

    log = create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.OPEN_BOX,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=req_data.notes or "开箱巡检",
        extra_context={"operation": "open_box"},
    )

    db.commit()
    logger.info(f"Beehive {hive.hive_code} opened by {current_user.username}")
    return get_operation_log_response_model(log)

@app.post("/api/hives/{hive_id}/harvest", response_model=OperationLogResponse)
async def harvest_beehive(
    hive_id: int,
    req_data: HarvestRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"]))
):
    """采蜜操作（自动记录审计日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    if hive.status != "active":
        raise HTTPException(status_code=400, detail="蜂箱已退役，无法操作")

    old_weight = hive.weight
    if hive.weight and hive.weight > req_data.harvest_kg:
        hive.weight = round(hive.weight - req_data.harvest_kg, 2)

    log = create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.HARVEST,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=f"采蜜 {req_data.harvest_kg}kg" + (f"，{req_data.notes}" if req_data.notes else ""),
        extra_context={
            "harvest_kg": req_data.harvest_kg,
            "weight_before": old_weight,
            "weight_after": hive.weight,
        },
    )

    db.commit()
    logger.info(f"Beehive {hive.hive_code} harvested {req_data.harvest_kg}kg by {current_user.username}")
    return get_operation_log_response_model(log)

@app.post("/api/hives/{hive_id}/queen-change", response_model=OperationLogResponse)
async def queen_change_beehive(
    hive_id: int,
    req_data: QueenChangeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"]))
):
    """换王操作（自动记录审计日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    if hive.status != "active":
        raise HTTPException(status_code=400, detail="蜂箱已退役，无法操作")

    old_queen_date = hive.queen_birth_date
    hive.queen_birth_date = datetime.utcnow()

    log = create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.QUEEN_CHANGE,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=f"换王：新蜂王编号 {req_data.new_queen_code}" + (f"，原因：{req_data.old_queen_reason}" if req_data.old_queen_reason else ""),
        extra_context={
            "new_queen_code": req_data.new_queen_code,
            "old_queen_reason": req_data.old_queen_reason,
            "old_queen_birth_date": old_queen_date.isoformat() if old_queen_date else None,
        },
    )

    db.commit()
    logger.info(f"Beehive {hive.hive_code} queen changed by {current_user.username}")
    return get_operation_log_response_model(log)

@app.post("/api/hives/{hive_id}/relocate", response_model=OperationLogResponse)
async def relocate_beehive(
    hive_id: int,
    req_data: RelocateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"]))
):
    """迁场操作（自动记录审计日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    if hive.status != "active":
        raise HTTPException(status_code=400, detail="蜂箱已退役，无法操作")

    old_apiary = hive.apiary_id
    hive.apiary_id = req_data.target_apiary

    log = create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.RELOCATE,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=f"迁场：从 {old_apiary} 到 {req_data.target_apiary}" + (f"，原因：{req_data.reason}" if req_data.reason else ""),
        extra_context={
            "from_apiary": old_apiary,
            "to_apiary": req_data.target_apiary,
            "reason": req_data.reason,
        },
    )

    db.commit()
    logger.info(f"Beehive {hive.hive_code} relocated by {current_user.username}")
    return get_operation_log_response_model(log)

@app.post("/api/hives/{hive_id}/retire", response_model=OperationLogResponse)
async def retire_beehive(
    hive_id: int,
    req_data: RetireRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"]))
):
    """退役蜂箱（自动记录审计日志）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")
    if hive.status == "retired":
        raise HTTPException(status_code=400, detail="蜂箱已退役")

    hive.status = "retired"
    hive.retired_at = datetime.utcnow()

    log = create_operation_log(
        db=db,
        hive=hive,
        operation_type=HiveOperationType.RETIRE,
        operator=current_user,
        source_ip=get_client_ip(request),
        description=f"蜂箱退役" + (f"，原因：{req_data.reason}" if req_data.reason else ""),
        extra_context={"retire_reason": req_data.reason},
    )

    db.commit()
    logger.info(f"Beehive {hive.hive_code} retired by {current_user.username}")
    return get_operation_log_response_model(log)

# ============ 操作日志查询接口 ============

@app.get("/api/operation-logs", response_model=OperationLogListResponse)
async def list_operation_logs(
    page: int = 1,
    size: int = 20,
    operator_id: Optional[int] = None,
    operator_username: Optional[str] = None,
    hive_id: Optional[int] = None,
    hive_code: Optional[str] = None,
    operation_types: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """分页查询操作日志，支持多维度筛选"""
    query = db.query(BeehiveOperationLog)

    if operator_id:
        query = query.filter(BeehiveOperationLog.operator_id == operator_id)
    if operator_username:
        query = query.filter(BeehiveOperationLog.operator_username.ilike(f"%{operator_username}%"))
    if hive_id:
        query = query.filter(BeehiveOperationLog.hive_id == hive_id)
    if hive_code:
        query = query.filter(BeehiveOperationLog.hive_code.ilike(f"%{hive_code}%"))
    if operation_types:
        types = [t.strip() for t in operation_types.split(",") if t.strip()]
        if types:
            query = query.filter(BeehiveOperationLog.operation_type.in_(types))
    if start_time:
        query = query.filter(BeehiveOperationLog.created_at >= start_time)
    if end_time:
        query = query.filter(BeehiveOperationLog.created_at <= end_time)
    if keyword:
        query = query.filter(
            (BeehiveOperationLog.hive_code.ilike(f"%{keyword}%")) |
            (BeehiveOperationLog.operator_username.ilike(f"%{keyword}%")) |
            (BeehiveOperationLog.description.ilike(f"%{keyword}%"))
        )

    total = query.count()
    query = query.order_by(BeehiveOperationLog.created_at.desc())
    offset = (page - 1) * size
    items = query.offset(offset).limit(size).all()

    return OperationLogListResponse(
        items=[get_operation_log_response_model(log) for log in items],
        total=total,
        page=page,
        size=size,
    )

@app.get("/api/operation-logs/{log_id}", response_model=OperationLogResponse)
async def get_operation_log_detail(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取单条操作日志详情"""
    log = db.query(BeehiveOperationLog).filter(BeehiveOperationLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="操作日志不存在")
    return get_operation_log_response_model(log)

@app.get("/api/operation-logs/export/csv")
async def export_operation_logs_csv(
    ids: Optional[str] = None,
    operator_id: Optional[int] = None,
    operator_username: Optional[str] = None,
    hive_id: Optional[int] = None,
    hive_code: Optional[str] = None,
    operation_types: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """导出操作日志为CSV文件"""
    query = db.query(BeehiveOperationLog)

    if ids:
        id_list = [int(i.strip()) for i in ids.split(",") if i.strip().isdigit()]
        if id_list:
            query = query.filter(BeehiveOperationLog.id.in_(id_list))
    else:
        if operator_id:
            query = query.filter(BeehiveOperationLog.operator_id == operator_id)
        if operator_username:
            query = query.filter(BeehiveOperationLog.operator_username.ilike(f"%{operator_username}%"))
        if hive_id:
            query = query.filter(BeehiveOperationLog.hive_id == hive_id)
        if hive_code:
            query = query.filter(BeehiveOperationLog.hive_code.ilike(f"%{hive_code}%"))
        if operation_types:
            types = [t.strip() for t in operation_types.split(",") if t.strip()]
            if types:
                query = query.filter(BeehiveOperationLog.operation_type.in_(types))
        if start_time:
            query = query.filter(BeehiveOperationLog.created_at >= start_time)
        if end_time:
            query = query.filter(BeehiveOperationLog.created_at <= end_time)
        if keyword:
            query = query.filter(
                (BeehiveOperationLog.hive_code.ilike(f"%{keyword}%")) |
                (BeehiveOperationLog.operator_username.ilike(f"%{keyword}%")) |
                (BeehiveOperationLog.description.ilike(f"%{keyword}%"))
            )

    query = query.order_by(BeehiveOperationLog.created_at.desc())
    logs = query.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "操作时间", "操作类型", "操作人", "蜂箱编号",
        "蜂箱ID", "来源IP", "操作描述", "上下文数据"
    ])

    for log in logs:
        op_name = OPERATION_TYPE_NAMES.get(log.operation_type, str(log.operation_type))
        writer.writerow([
            log.id,
            log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            op_name,
            log.operator_username,
            log.hive_code,
            log.hive_id,
            log.source_ip or "",
            log.description or "",
            log.context_data,
        ])

    output.seek(0)
    csv_bytes = output.getvalue().encode("utf-8-sig")

    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=operation_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        },
    )

@app.get("/api/operation-logs/meta/operators")
async def get_operators_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取操作人列表（用于筛选下拉）"""
    users = db.query(User).all()
    return [
        {"id": u.id, "username": u.username, "role": u.role.value, "role_name": ROLE_NAMES.get(u.role, str(u.role))}
        for u in users
    ]

@app.get("/api/operation-logs/meta/operation-types")
async def get_operation_types_list(
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取操作类型列表（用于筛选多选）"""
    return [
        {"value": op.value, "label": name}
        for op, name in OPERATION_TYPE_NAMES.items()
    ]

# ============ 蜂箱附件管理接口 ============

@app.get("/api/hives/{hive_id}/attachments", response_model=AttachmentListResponse)
async def list_hive_attachments(
    hive_id: int,
    page: int = 1,
    size: int = 20,
    media_type: Optional[str] = None,
    month: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """分页获取蜂箱附件列表，含临时下载链接"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    query = db.query(BeehiveAttachment).filter(BeehiveAttachment.hive_id == hive_id)

    if media_type:
        query = query.filter(BeehiveAttachment.media_type == media_type)

    if month:
        try:
            year, mon = month.split("-")
            start_date = datetime(int(year), int(mon), 1)
            if int(mon) == 12:
                end_date = datetime(int(year) + 1, 1, 1)
            else:
                end_date = datetime(int(year), int(mon) + 1, 1)
            query = query.filter(
                BeehiveAttachment.shot_at >= start_date,
                BeehiveAttachment.shot_at < end_date,
            )
        except (ValueError, TypeError):
            pass

    total = query.count()
    query = query.order_by(
        case(
            (BeehiveAttachment.shot_at.is_(None), 1),
            else_=0
        ).asc(),
        BeehiveAttachment.shot_at.desc(),
        BeehiveAttachment.created_at.desc()
    )
    offset = (page - 1) * size
    items = query.offset(offset).limit(size).all()

    months_query = db.query(BeehiveAttachment).filter(BeehiveAttachment.hive_id == hive_id)
    all_atts = months_query.order_by(
        case(
            (BeehiveAttachment.shot_at.is_(None), 1),
            else_=0
        ).asc(),
        BeehiveAttachment.shot_at.desc(),
        BeehiveAttachment.created_at.desc()
    ).all()
    month_set = set()
    for att in all_atts:
        if att.shot_at:
            month_set.add(att.shot_at.strftime("%Y-%m"))
    months = sorted(list(month_set), reverse=True)

    return AttachmentListResponse(
        items=[get_attachment_response_model(att) for att in items],
        total=total,
        page=page,
        size=size,
        months=months,
    )

@app.post("/api/hives/{hive_id}/attachments", response_model=AttachmentUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_hive_attachment(
    hive_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    shot_at: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """上传蜂箱附件（单文件，不超过10MB）"""
    hive = db.query(Beehive).filter(Beehive.id == hive_id).first()
    if not hive:
        raise HTTPException(status_code=404, detail="蜂箱不存在")

    media_type = detect_media_type(file.filename or "")
    if not media_type:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型。支持的图片格式: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}，视频格式: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}",
        )

    file_content = await file.read()
    file_size = len(file_content)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"文件大小超过限制，最大支持 {MAX_FILE_SIZE // (1024*1024)}MB",
        )

    if file_size == 0:
        raise HTTPException(status_code=400, detail="文件不能为空")

    file_key = generate_file_key(hive.hive_code, media_type, file.filename or "unknown")

    try:
        client = get_minio_client()
        import io as _io
        client.put_object(
            MINIO_BUCKET,
            file_key,
            _io.BytesIO(file_content),
            file_size,
            content_type=file.content_type,
        )
    except Exception as e:
        logger.error(f"Failed to upload file to MinIO: {e}")
        raise HTTPException(status_code=500, detail="文件存储失败")

    tag_list = []
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    shot_at_dt = None
    if shot_at:
        try:
            shot_at_dt = datetime.fromisoformat(shot_at)
        except (ValueError, TypeError):
            shot_at_dt = None

    attachment = BeehiveAttachment(
        hive_id=hive.id,
        hive_code=hive.hive_code,
        uploader_id=current_user.id,
        uploader_username=current_user.username,
        file_key=file_key,
        file_name=file.filename or "unknown",
        media_type=media_type,
        file_size=file_size,
        mime_type=file.content_type,
        shot_at=shot_at_dt,
        tags=json.dumps(tag_list, ensure_ascii=False),
        description=description,
        created_at=datetime.utcnow(),
    )

    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    logger.info(f"Attachment uploaded by {current_user.username} for hive {hive.hive_code}: {file.filename}")

    return AttachmentUploadResponse(
        id=attachment.id,
        file_name=attachment.file_name,
        media_type=attachment.media_type,
        file_size=attachment.file_size,
        message="上传成功",
    )

@app.delete("/api/hives/attachments/{attachment_id}")
async def delete_hive_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    """删除单条蜂箱附件"""
    attachment = db.query(BeehiveAttachment).filter(BeehiveAttachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="附件不存在")

    if current_user.role != UserRole.FARM_OWNER and attachment.uploader_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权限删除他人上传的附件")

    try:
        client = get_minio_client()
        client.remove_object(MINIO_BUCKET, attachment.file_key)
    except Exception as e:
        logger.warning(f"Failed to delete file from MinIO: {e}")

    db.delete(attachment)
    db.commit()

    logger.info(f"Attachment {attachment_id} deleted by {current_user.username}")

    return {"message": "删除成功", "id": attachment_id}

@app.get("/api/hives/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取附件下载的临时链接（重定向到预签名URL）"""
    from fastapi.responses import RedirectResponse

    attachment = db.query(BeehiveAttachment).filter(BeehiveAttachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="附件不存在")

    download_url = get_presigned_download_url(attachment.file_key)
    if not download_url:
        raise HTTPException(status_code=500, detail="生成下载链接失败")

    return RedirectResponse(url=download_url)


# ============ 蜂箱评论接口 ============

@app.get("/api/hives/{hive_id}/comments", response_model=CommentListResponse)
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


@app.post("/api/hives/{hive_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
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


@app.delete("/api/hives/comments/{comment_id}")
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


@app.post("/api/hives/comments/{comment_id}/like")
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


# ============ 蜂箱点赞接口 ============

@app.get("/api/hives/{hive_id}/like-status", response_model=LikeStatusResponse)
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


@app.post("/api/hives/{hive_id}/toggle-like", response_model=LikeToggleResponse)
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


@app.get("/api/users/mention-list")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
