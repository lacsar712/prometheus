import logging
import time
import random
import os
import asyncio
import json
from datetime import datetime, timedelta
from enum import Enum as PyEnum
from typing import Optional, List, Dict

from fastapi import FastAPI, HTTPException, Request, Depends, status, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Enum, Text, Float, ForeignKey, Boolean, case, UniqueConstraint, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, EmailStr, Field, validator
from fastapi.responses import StreamingResponse, JSONResponse
import io
import csv
from passlib.context import CryptContext
import jwt
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import re

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

# 蜜源植物类型
class NectarPlantType(str, PyEnum):
    RAPE = "rape"                   # 油菜
    LOCUST = "locust"               # 洋槐
    LINDEN = "linden"               # 椴树
    VITEX = "vitex"                 # 荆条
    JUJUBE = "jujube"               # 枣花
    SUNFLOWER = "sunflower"         # 向日葵
    BUCKWHEAT = "buckwheat"         # 荞麦
    ECHIUM = "echium"               # 野香草
    OTHER = "other"                 # 其他

NECTAR_PLANT_NAMES = {
    NectarPlantType.RAPE: "油菜",
    NectarPlantType.LOCUST: "洋槐",
    NectarPlantType.LINDEN: "椴树",
    NectarPlantType.VITEX: "荆条",
    NectarPlantType.JUJUBE: "枣花",
    NectarPlantType.SUNFLOWER: "向日葵",
    NectarPlantType.BUCKWHEAT: "荞麦",
    NectarPlantType.ECHIUM: "野香草",
    NectarPlantType.OTHER: "其他",
}

# 蜜源植物颜色映射（用于前端热力图）
NECTAR_PLANT_COLORS = {
    NectarPlantType.RAPE: "#FFD700",        # 金黄色
    NectarPlantType.LOCUST: "#FFFFFF",      # 白色
    NectarPlantType.LINDEN: "#E6E6FA",      # 淡紫色
    NectarPlantType.VITEX: "#9370DB",       # 中紫色
    NectarPlantType.JUJUBE: "#F0E68C",      # 卡其色
    NectarPlantType.SUNFLOWER: "#FFA500",   # 橙色
    NectarPlantType.BUCKWHEAT: "#8B4513",   #  saddle棕色
    NectarPlantType.ECHIUM: "#4169E1",      # 皇家蓝
    NectarPlantType.OTHER: "#808080",       # 灰色
}

# 转场计划状态
class RelocationStatus(str, PyEnum):
    PLANNED = "planned"             # 计划中
    IN_TRANSIT = "in_transit"       # 运输中
    COMPLETED = "completed"         # 已完成
    CANCELLED = "cancelled"         # 已取消

RELOCATION_STATUS_NAMES = {
    RelocationStatus.PLANNED: "计划中",
    RelocationStatus.IN_TRANSIT: "运输中",
    RelocationStatus.COMPLETED: "已完成",
    RelocationStatus.CANCELLED: "已取消",
}

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


class RateLimitRule(Base):
    __tablename__ = "rate_limit_rules"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    path_pattern = Column(String(500), nullable=False, default="/api/sensor-data")
    device_id_pattern = Column(String(500), nullable=False, default="*")
    ip_range = Column(String(500), nullable=True)
    rate_limit = Column(Integer, nullable=False, default=60)
    burst = Column(Integer, nullable=False, default=10)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeviceBan(Base):
    __tablename__ = "device_bans"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(200), nullable=False, unique=True, index=True)
    reason = Column(String(500), nullable=True)
    banned_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    banned_by = Column(Integer, ForeignKey("users.id"), nullable=True)


# ========== API Key 业务范围枚举 ==========
class ApiKeyScope(str, PyEnum):
    SENSOR_READ = "sensor_data:read"
    SENSOR_WRITE = "sensor_data:write"
    HIVES_READ = "hives:read"
    HIVES_WRITE = "hives:write"
    OPERATION_LOGS_READ = "operation_logs:read"
    INSPECTION_PLANS_READ = "inspection_plans:read"
    INSPECTION_PLANS_WRITE = "inspection_plans:write"
    ALL = "all"

SCOPE_NAMES = {
    ApiKeyScope.SENSOR_READ: "读取传感器数据",
    ApiKeyScope.SENSOR_WRITE: "写入传感器数据",
    ApiKeyScope.HIVES_READ: "读取蜂箱信息",
    ApiKeyScope.HIVES_WRITE: "写入蜂箱信息",
    ApiKeyScope.OPERATION_LOGS_READ: "读取操作日志",
    ApiKeyScope.INSPECTION_PLANS_READ: "读取巡检计划",
    ApiKeyScope.INSPECTION_PLANS_WRITE: "写入巡检计划",
    ApiKeyScope.ALL: "全部权限",
}

API_KEY_HEADER = "X-API-Key"
API_KEY_PREFIX_LENGTH = 8
API_KEY_SECRET_LENGTH = 32


# ========== API Key 数据库模型 ==========
class ApiKey(Base):
    __tablename__ = "api_keys"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    key_prefix = Column(String(20), nullable=False, index=True)
    hashed_key = Column(String(255), nullable=False, unique=True)
    scopes = Column(Text, nullable=False, default="[]")
    expires_at = Column(DateTime, nullable=True, index=True)
    last_used_at = Column(DateTime, nullable=True)
    bound_device_id = Column(String(200), nullable=True, index=True)
    issuer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    is_revoked = Column(Boolean, nullable=False, default=False, index=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    issuer = relationship("User", foreign_keys=[issuer_id])
    revoker = relationship("User", foreign_keys=[revoked_by])
    call_logs = relationship("ApiKeyCallLog", back_populates="api_key", cascade="all, delete-orphan")


class ApiKeyCallLog(Base):
    __tablename__ = "api_key_call_logs"
    id = Column(Integer, primary_key=True, index=True)
    api_key_id = Column(Integer, ForeignKey("api_keys.id"), nullable=False, index=True)
    path = Column(String(500), nullable=False)
    method = Column(String(20), nullable=False)
    status_code = Column(Integer, nullable=False)
    source_ip = Column(String(50), nullable=True)
    device_id = Column(String(200), nullable=True, index=True)
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    api_key = relationship("ApiKey", back_populates="call_logs")


# ========== 巡检计划相关枚举 ==========
class PlanSeason(str, PyEnum):
    SPRING = "spring"        # 春繁
    AUTUMN = "autumn"        # 秋繁
    WINTER = "winter"        # 越冬
    CUSTOM = "custom"        # 自定义

SEASON_NAMES = {
    PlanSeason.SPRING: "春繁",
    PlanSeason.AUTUMN: "秋繁",
    PlanSeason.WINTER: "越冬",
    PlanSeason.CUSTOM: "自定义",
}

class PlanStatus(str, PyEnum):
    PENDING = "pending"      # 待巡检
    IN_PROGRESS = "in_progress"  # 巡检中
    COMPLETED = "completed"  # 已完成
    CANCELLED = "cancelled"  # 已取消

PLAN_STATUS_NAMES = {
    PlanStatus.PENDING: "待巡检",
    PlanStatus.IN_PROGRESS: "巡检中",
    PlanStatus.COMPLETED: "已完成",
    PlanStatus.CANCELLED: "已取消",
}

class ExecutionStatus(str, PyEnum):
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"

EXECUTION_STATUS_NAMES = {
    ExecutionStatus.SUCCESS: "成功",
    ExecutionStatus.FAILED: "失败",
    ExecutionStatus.PARTIAL: "部分成功",
}


# ========== 消息中心相关枚举 ==========
class MessageCategory(str, PyEnum):
    ALERT = "alert"           # 蜂群告警
    SYSTEM = "system"         # 系统通知
    BUSINESS = "business"     # 业务消息

MESSAGE_CATEGORY_NAMES = {
    MessageCategory.ALERT: "蜂群告警",
    MessageCategory.SYSTEM: "系统通知",
    MessageCategory.BUSINESS: "业务消息",
}


class SeverityLevel(str, PyEnum):
    INFO = "info"             # 提示
    WARNING = "warning"       # 警告
    CRITICAL = "critical"     # 严重

SEVERITY_LEVEL_NAMES = {
    SeverityLevel.INFO: "提示",
    SeverityLevel.WARNING: "警告",
    SeverityLevel.CRITICAL: "严重",
}


# ========== 巡检计划相关数据库模型 ==========
class InspectionPlan(Base):
    __tablename__ = "inspection_plans"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    season = Column(Enum(PlanSeason), nullable=False, default=PlanSeason.CUSTOM)
    cron_expression = Column(String(100), nullable=False)
    filter_conditions = Column(Text, nullable=False, default="{}")
    checklist_items = Column(Text, nullable=False, default="[]")
    is_enabled = Column(Boolean, nullable=False, default=True)
    description = Column(Text, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    execution_logs = relationship("InspectionExecutionLog", back_populates="plan", cascade="all, delete-orphan")
    tickets = relationship("InspectionTicket", back_populates="plan", cascade="all, delete-orphan")


class InspectionTicket(Base):
    __tablename__ = "inspection_tickets"
    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("inspection_plans.id"), nullable=False, index=True)
    plan_name = Column(String(200), nullable=False)
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)
    hive_code = Column(String(50), index=True, nullable=False)
    status = Column(Enum(PlanStatus), nullable=False, default=PlanStatus.PENDING, index=True)
    checklist_items = Column(Text, nullable=False, default="[]")
    checklist_results = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    executed_at = Column(DateTime, nullable=True)
    executed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    due_at = Column(DateTime, nullable=True)

    plan = relationship("InspectionPlan", back_populates="tickets")
    beehive = relationship("Beehive")


class InspectionExecutionLog(Base):
    __tablename__ = "inspection_execution_logs"
    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("inspection_plans.id"), nullable=False, index=True)
    plan_name = Column(String(200), nullable=False)
    status = Column(Enum(ExecutionStatus), nullable=False, default=ExecutionStatus.SUCCESS, index=True)
    total_hives = Column(Integer, nullable=False, default=0)
    success_hives = Column(Integer, nullable=False, default=0)
    failed_hives = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    triggered_by = Column(String(50), nullable=False, default="scheduler")
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    finished_at = Column(DateTime, nullable=True)

    plan = relationship("InspectionPlan", back_populates="execution_logs")


# ========== 消息中心数据库模型 ==========
class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(Enum(MessageCategory), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    severity = Column(Enum(SeverityLevel), nullable=False, default=SeverityLevel.INFO, index=True)
    is_read = Column(Boolean, nullable=False, default=False, index=True)
    source = Column(String(100), nullable=True)
    related_id = Column(Integer, nullable=True)
    extra_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    read_at = Column(DateTime, nullable=True)

    user = relationship("User")


# ========== 蜜源花期日历数据库模型 ==========
class NectarCalendar(Base):
    __tablename__ = "nectar_calendars"
    id = Column(Integer, primary_key=True, index=True)
    plant_type = Column(Enum(NectarPlantType), nullable=False, index=True)  # 蜜源植物类型
    plant_name = Column(String(100), nullable=False)  # 植物名称（自定义）
    location_name = Column(String(200), nullable=False)  # 地理位置名称
    location_lat = Column(Float, nullable=False, index=True)  # 纬度
    location_lng = Column(Float, nullable=False, index=True)  # 经度
    bloom_start_date = Column(DateTime, nullable=False, index=True)  # 预计开花开始日期
    bloom_end_date = Column(DateTime, nullable=False, index=True)  # 预计开花结束日期
    max_hive_capacity = Column(Integer, nullable=False, default=100)  # 可承载蜂群数
    nectar_quality = Column(String(20), nullable=True)  # 蜜质等级
    notes = Column(Text, nullable=True)  # 备注
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)  # 创建人ID
    created_by_username = Column(String(50), nullable=False)  # 创建人用户名
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    creator = relationship("User", foreign_keys=[created_by])


# ========== 转场计划数据库模型 ==========
class RelocationPlan(Base):
    __tablename__ = "relocation_plans"
    id = Column(Integer, primary_key=True, index=True)
    plan_name = Column(String(200), nullable=False)  # 计划名称
    source_apiary_id = Column(String(100), nullable=False)  # 出发蜂场ID
    source_location_name = Column(String(200), nullable=False)  # 出发地名称
    source_lat = Column(Float, nullable=False)  # 出发地纬度
    source_lng = Column(Float, nullable=False)  # 出发地经度
    destination_apiary_id = Column(String(100), nullable=False)  # 目的地蜂场ID
    destination_location_name = Column(String(200), nullable=False)  # 目的地名称
    destination_lat = Column(Float, nullable=False)  # 目的地纬度
    destination_lng = Column(Float, nullable=False)  # 目的地经度
    departure_date = Column(DateTime, nullable=False, index=True)  # 出发日期
    estimated_arrival_date = Column(DateTime, nullable=True)  # 预计到达日期
    transport_vehicle = Column(String(100), nullable=True)  # 运输车辆
    distance_km = Column(Float, nullable=True)  # 直线距离（公里）
    beekeepers = Column(Text, nullable=False, default="[]")  # 随行养蜂员列表（JSON数组）
    hive_list = Column(Text, nullable=False, default="[]")  # 装车蜂箱清单（JSON数组，包含蜂箱ID、健康度、蜂王状态、巢框数、装车顺序等）
    status = Column(Enum(RelocationStatus), nullable=False, default=RelocationStatus.PLANNED, index=True)  # 状态
    notes = Column(Text, nullable=True)  # 备注
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)  # 创建人ID
    created_by_username = Column(String(50), nullable=False)  # 创建人用户名
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)  # 完成时间

    creator = relationship("User", foreign_keys=[created_by])


# ========== 迁场日志数据库模型 ==========
class RelocationLog(Base):
    __tablename__ = "relocation_logs"
    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("relocation_plans.id"), nullable=False, index=True)  # 关联的转场计划ID
    hive_id = Column(Integer, ForeignKey("beehives.id"), nullable=False, index=True)  # 蜂箱ID
    hive_code = Column(String(50), nullable=False, index=True)  # 蜂箱编号
    source_apiary_id = Column(String(100), nullable=False)  # 原蜂场ID
    destination_apiary_id = Column(String(100), nullable=False)  # 新蜂场ID
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 操作人ID
    operator_username = Column(String(50), nullable=False)  # 操作人用户名
    context_data = Column(Text, nullable=False, default="{}")  # 迁场时上下文数据（JSON）
    description = Column(String(500), nullable=True)  # 描述
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    plan = relationship("RelocationPlan")
    beehive = relationship("Beehive")
    operator = relationship("User", foreign_keys=[operator_id])


# ========== 消息中心 Pydantic 模型 ==========
class NotificationBase(BaseModel):
    category: MessageCategory
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    severity: SeverityLevel = SeverityLevel.INFO
    source: Optional[str] = None
    related_id: Optional[int] = None
    extra_data: Optional[Dict] = None


class NotificationCreate(NotificationBase):
    user_id: int


class NotificationDispatchRequest(BaseModel):
    category: MessageCategory
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    severity: SeverityLevel = SeverityLevel.INFO
    source: Optional[str] = None
    related_id: Optional[int] = None
    extra_data: Optional[Dict] = None
    user_ids: Optional[List[int]] = None
    target_roles: Optional[List[UserRole]] = None
    target_farm_ids: Optional[List[str]] = None


class NotificationResponse(BaseModel):
    id: int
    user_id: int
    category: MessageCategory
    category_name: str
    title: str
    content: str
    severity: SeverityLevel
    severity_name: str
    is_read: bool
    source: Optional[str]
    related_id: Optional[int]
    extra_data: Optional[Dict]
    created_at: datetime
    read_at: Optional[datetime]

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    unread_count: int


class UnreadCountResponse(BaseModel):
    total: int
    by_category: Dict[str, int]


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


# ========== 转场清单蜂箱项 Pydantic 模型 ==========
class RelocationHiveItem(BaseModel):
    hive_id: int
    hive_code: str
    health_level: StrengthLevel = StrengthLevel.MEDIUM  # 蜂群健康度
    queen_status: str = "normal"  # 女王蜂状态 normal/weak/queenless
    frame_count: int = 10  # 巢框数量
    load_order: Optional[int] = None  # 装车顺序
    is_checked: bool = False  # 是否已勾选检查
    notes: Optional[str] = None


# ========== 蜜源花期日历 Pydantic 模型 ==========
class NectarCalendarBase(BaseModel):
    plant_type: NectarPlantType
    plant_name: str = Field(..., min_length=1, max_length=100)
    location_name: str = Field(..., min_length=1, max_length=200)
    location_lat: float
    location_lng: float
    bloom_start_date: datetime
    bloom_end_date: datetime
    max_hive_capacity: int = 100
    nectar_quality: Optional[str] = None
    notes: Optional[str] = None


class NectarCalendarCreate(NectarCalendarBase):
    pass


class NectarCalendarUpdate(BaseModel):
    plant_type: Optional[NectarPlantType] = None
    plant_name: Optional[str] = None
    location_name: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    bloom_start_date: Optional[datetime] = None
    bloom_end_date: Optional[datetime] = None
    max_hive_capacity: Optional[int] = None
    nectar_quality: Optional[str] = None
    notes: Optional[str] = None


class NectarCalendarResponse(BaseModel):
    id: int
    plant_type: NectarPlantType
    plant_type_name: str
    plant_name: str
    location_name: str
    location_lat: float
    location_lng: float
    bloom_start_date: datetime
    bloom_end_date: datetime
    max_hive_capacity: int
    nectar_quality: Optional[str]
    notes: Optional[str]
    created_by: int
    created_by_username: str
    created_at: datetime
    updated_at: datetime
    color: str

    class Config:
        from_attributes = True


class NectarCalendarListResponse(BaseModel):
    items: List[NectarCalendarResponse]
    total: int
    page: int
    size: int


# ========== 转场计划 Pydantic 模型 ==========
class RelocationPlanBase(BaseModel):
    plan_name: str = Field(..., min_length=1, max_length=200)
    source_apiary_id: str
    source_location_name: str
    source_lat: float
    source_lng: float
    destination_apiary_id: str
    destination_location_name: str
    destination_lat: float
    destination_lng: float
    departure_date: datetime
    estimated_arrival_date: Optional[datetime] = None
    transport_vehicle: Optional[str] = None
    distance_km: Optional[float] = None
    beekeepers: List[str] = []
    hive_list: List[RelocationHiveItem] = []
    notes: Optional[str] = None


class RelocationPlanCreate(RelocationPlanBase):
    pass


class RelocationPlanUpdate(BaseModel):
    plan_name: Optional[str] = None
    source_apiary_id: Optional[str] = None
    source_location_name: Optional[str] = None
    source_lat: Optional[float] = None
    source_lng: Optional[float] = None
    destination_apiary_id: Optional[str] = None
    destination_location_name: Optional[str] = None
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    departure_date: Optional[datetime] = None
    estimated_arrival_date: Optional[datetime] = None
    transport_vehicle: Optional[str] = None
    distance_km: Optional[float] = None
    beekeepers: Optional[List[str]] = None
    hive_list: Optional[List[RelocationHiveItem]] = None
    status: Optional[RelocationStatus] = None
    notes: Optional[str] = None


class RelocationPlanResponse(BaseModel):
    id: int
    plan_name: str
    source_apiary_id: str
    source_location_name: str
    source_lat: float
    source_lng: float
    destination_apiary_id: str
    destination_location_name: str
    destination_lat: float
    destination_lng: float
    departure_date: datetime
    estimated_arrival_date: Optional[datetime]
    transport_vehicle: Optional[str]
    distance_km: Optional[float]
    beekeepers: List[str]
    hive_list: List[Dict]
    status: RelocationStatus
    status_name: str
    notes: Optional[str]
    created_by: int
    created_by_username: str
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class RelocationPlanListResponse(BaseModel):
    items: List[RelocationPlanResponse]
    total: int
    page: int
    size: int


# ========== 距离估算响应模型 ==========
class DistanceEstimateResponse(BaseModel):
    distance_km: float
    estimated_duration_hours: float
    estimated_arrival_time: Optional[datetime] = None


# ========== 迁场日志 Pydantic 模型 ==========
class RelocationLogResponse(BaseModel):
    id: int
    plan_id: int
    hive_id: int
    hive_code: str
    source_apiary_id: str
    destination_apiary_id: str
    operator_id: int
    operator_username: str
    context_data: Dict
    description: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class RelocationLogListResponse(BaseModel):
    items: List[RelocationLogResponse]
    total: int
    page: int
    size: int


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

# ========== 巡检计划相关 Pydantic 模型 ==========
class InspectionPlanBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=200, description="计划名称")
    season: PlanSeason = Field(default=PlanSeason.CUSTOM, description="季节类型")
    cron_expression: str = Field(..., max_length=100, description="Cron表达式，如 0 9 1 3 * 表示每年3月1日9点")
    filter_conditions: dict = Field(default_factory=dict, description="蜂箱筛选条件，如 {\"apiary_id\": \"xxx\", \"strength_level\": \"strong\"}")
    checklist_items: List[str] = Field(default_factory=list, description="巡检清单项")
    is_enabled: bool = Field(default=True, description="是否启用")
    description: Optional[str] = Field(None, max_length=1000, description="计划描述")

class InspectionPlanCreate(InspectionPlanBase):
    pass

class InspectionPlanUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=200)
    season: Optional[PlanSeason] = None
    cron_expression: Optional[str] = Field(None, max_length=100)
    filter_conditions: Optional[dict] = None
    checklist_items: Optional[List[str]] = None
    is_enabled: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=1000)

class InspectionPlanResponse(BaseModel):
    id: int
    name: str
    season: PlanSeason
    season_name: str
    cron_expression: str
    filter_conditions: dict
    checklist_items: List[str]
    is_enabled: bool
    description: Optional[str]
    last_run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    affected_hive_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class InspectionPlanListResponse(BaseModel):
    items: List[InspectionPlanResponse]
    total: int

class InspectionTemplateResponse(BaseModel):
    season: PlanSeason
    season_name: str
    name: str
    cron_expression: str
    description: str
    checklist_items: List[str]

class CronParseResponse(BaseModel):
    cron_expression: str
    is_valid: bool
    next_run_at: Optional[datetime]
    error_message: Optional[str]

class InspectionTicketResponse(BaseModel):
    id: int
    plan_id: int
    plan_name: str
    hive_id: int
    hive_code: str
    status: PlanStatus
    status_name: str
    checklist_items: List[str]
    checklist_results: Optional[dict]
    notes: Optional[str]
    executed_at: Optional[datetime]
    created_at: datetime
    due_at: Optional[datetime]

    class Config:
        from_attributes = True

class ExecutionLogResponse(BaseModel):
    id: int
    plan_id: int
    plan_name: str
    status: ExecutionStatus
    status_name: str
    total_hives: int
    success_hives: int
    failed_hives: int
    error_message: Optional[str]
    triggered_by: str
    started_at: datetime
    finished_at: Optional[datetime]
    duration_seconds: Optional[float]

    class Config:
        from_attributes = True

class ExecutionLogListResponse(BaseModel):
    items: List[ExecutionLogResponse]
    total: int

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

# ========== 传感器流控相关 Pydantic 模型 ==========
class RateLimitRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="规则名称")
    path_pattern: str = Field(default="/api/sensor-data", max_length=500, description="业务路径模式")
    device_id_pattern: str = Field(default="*", max_length=500, description="设备ID匹配模式")
    ip_range: Optional[str] = Field(None, max_length=500, description="IP段，如 192.168.1.0/24")
    rate_limit: int = Field(default=60, gt=0, description="每分钟令牌数")
    burst: int = Field(default=10, gt=0, description="突发容量")
    is_enabled: bool = Field(default=True, description="是否启用")

class RateLimitRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    path_pattern: Optional[str] = Field(None, max_length=500)
    device_id_pattern: Optional[str] = Field(None, max_length=500)
    ip_range: Optional[str] = Field(None, max_length=500)
    rate_limit: Optional[int] = Field(None, gt=0)
    burst: Optional[int] = Field(None, gt=0)
    is_enabled: Optional[bool] = None

class RateLimitRuleResponse(BaseModel):
    id: int
    name: str
    path_pattern: str
    device_id_pattern: str
    ip_range: Optional[str]
    rate_limit: int
    burst: int
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DeviceBanRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=200, description="设备ID")
    reason: Optional[str] = Field(None, max_length=500, description="封禁原因")
    duration_minutes: Optional[int] = Field(None, gt=0, description="封禁时长(分钟)，为空则永久")

class DeviceBanResponse(BaseModel):
    id: int
    device_id: str
    reason: Optional[str]
    banned_at: datetime
    expires_at: Optional[datetime]
    is_active: bool

    class Config:
        from_attributes = True

class DeviceTokenStats(BaseModel):
    device_id: str
    remaining_tokens: float
    rate_limit: int
    hit_count_5min: int

class RateLimitHitTimeSeries(BaseModel):
    timestamp: str
    hit_count: int

class SensorDataRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=200, description="设备ID")
    apiary_id: Optional[str] = Field(None, description="蜂场ID")
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    weight: Optional[float] = None
    extra: Optional[dict] = None


# ========== API Key Pydantic 模型 ==========
class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="凭证自定义名称")
    scopes: List[str] = Field(..., description="可调用的业务范围列表")
    expires_days: Optional[int] = Field(None, ge=1, description="过期天数，留空表示永不过期")
    bound_device_id: Optional[str] = Field(None, max_length=200, description="可选绑定的设备ID")

    @validator('scopes')
    def validate_scopes(cls, v):
        valid_scopes = {s.value for s in ApiKeyScope}
        for scope in v:
            if scope not in valid_scopes:
                raise ValueError(f"无效的业务范围: {scope}")
        if len(v) == 0:
            raise ValueError("至少选择一个业务范围")
        return v


class ApiKeyCreatedResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    full_key: str
    scopes: List[str]
    scope_names: List[str]
    expires_at: Optional[datetime]
    bound_device_id: Optional[str]
    created_at: datetime


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: List[str]
    scope_names: List[str]
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]
    bound_device_id: Optional[str]
    issuer_id: int
    issuer_username: str
    is_revoked: bool
    revoked_at: Optional[datetime]
    created_at: datetime


class ApiKeyListResponse(BaseModel):
    items: List[ApiKeyResponse]
    total: int


class ApiKeyCallLogResponse(BaseModel):
    id: int
    path: str
    method: str
    status_code: int
    source_ip: Optional[str]
    device_id: Optional[str]
    user_agent: Optional[str]
    created_at: datetime


class ApiKeyCallLogListResponse(BaseModel):
    items: List[ApiKeyCallLogResponse]
    total: int


class ApiKeyScopesResponse(BaseModel):
    scopes: List[dict]


class ApiKeyRevokeResponse(BaseModel):
    message: str
    id: int


# ========== 令牌桶限流引擎 ==========
import threading as _threading
import ipaddress

_rate_limit_lock = _threading.Lock()
_token_buckets: dict = {}
_rate_limit_hits: dict = {}
_device_last_access: dict = {}

class TokenBucket:
    def __init__(self, rate: int, burst: int):
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.last_refill = time.time()

    def consume(self, tokens: int = 1) -> bool:
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.burst, self.tokens + elapsed * (self.rate / 60.0))
        self.last_refill = now
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

    def get_remaining(self) -> float:
        now = time.time()
        elapsed = now - self.last_refill
        return min(self.burst, self.tokens + elapsed * (self.rate / 60.0))

def _get_bucket_key(device_id: str, path: str) -> str:
    return f"{device_id}:{path}"

def _ip_in_range(ip_str: str, ip_range: str) -> bool:
    if not ip_range or not ip_str:
        return True
    try:
        if '/' in ip_range:
            network = ipaddress.ip_network(ip_range, strict=False)
            return ipaddress.ip_address(ip_str) in network
        else:
            return ip_str == ip_range
    except ValueError:
        return ip_str == ip_range

def _match_pattern(value: str, pattern: str) -> bool:
    if pattern == '*':
        return True
    if pattern.startswith('*') and pattern.endswith('*'):
        return pattern[1:-1] in value
    if pattern.startswith('*'):
        return value.endswith(pattern[1:])
    if pattern.endswith('*'):
        return value.startswith(pattern[:-1])
    return value == pattern

def _find_matching_rule(device_id: str, path: str, ip_str: str, db: Session) -> Optional[RateLimitRule]:
    rules = db.query(RateLimitRule).filter(RateLimitRule.is_enabled == True).all()
    for rule in rules:
        if not _match_pattern(device_id, rule.device_id_pattern):
            continue
        if not _match_pattern(path, rule.path_pattern):
            continue
        if rule.ip_range and not _ip_in_range(ip_str, rule.ip_range):
            continue
        return rule
    return None

def _record_hit(device_id: str, path: str):
    now = time.time()
    key = f"{device_id}:{path}"
    if key not in _rate_limit_hits:
        _rate_limit_hits[key] = []
    _rate_limit_hits[key].append(now)
    cutoff = now - 300
    _rate_limit_hits[key] = [t for t in _rate_limit_hits[key] if t > cutoff]

def _get_hit_count(device_id: str, path: str) -> int:
    key = f"{device_id}:{path}"
    if key not in _rate_limit_hits:
        return 0
    now = time.time()
    cutoff = now - 300
    hits = [t for t in _rate_limit_hits[key] if t > cutoff]
    _rate_limit_hits[key] = hits
    return len(hits)

def check_rate_limit(device_id: str, path: str, ip_str: str, db: Session) -> tuple[bool, Optional[str], Optional[int]]:
    rule = _find_matching_rule(device_id, path, ip_str, db)
    if not rule:
        bucket_key = _get_bucket_key(device_id, path)
        with _rate_limit_lock:
            if bucket_key not in _token_buckets:
                _token_buckets[bucket_key] = TokenBucket(rate=60, burst=10)
            bucket = _token_buckets[bucket_key]
            if bucket.consume():
                _device_last_access[device_id] = time.time()
                return True, None, int(bucket.get_remaining())
            else:
                _record_hit(device_id, path)
                _device_last_access[device_id] = time.time()
                return False, "请求过于频繁，请稍后重试", 0
    bucket_key = _get_bucket_key(device_id, path)
    with _rate_limit_lock:
        if bucket_key not in _token_buckets:
            _token_buckets[bucket_key] = TokenBucket(rate=rule.rate_limit, burst=rule.burst)
        bucket = _token_buckets[bucket_key]
        if bucket.rate != rule.rate_limit or bucket.burst != rule.burst:
            bucket.rate = rule.rate_limit
            bucket.burst = rule.burst
            bucket.tokens = min(bucket.tokens, float(rule.burst))
        if bucket.consume():
            _device_last_access[device_id] = time.time()
            return True, None, int(bucket.get_remaining())
        else:
            _record_hit(device_id, path)
            _device_last_access[device_id] = time.time()
            return False, "请求过于频繁，请稍后重试", 0

def get_all_device_stats(db: Session) -> List[DeviceTokenStats]:
    stats = []
    seen_devices = set()
    with _rate_limit_lock:
        for key, bucket in _token_buckets.items():
            device_id, path = key.rsplit(":", 1) if ":" in key else (key, "")
            if device_id in seen_devices:
                continue
            seen_devices.add(device_id)
            hit_count = _get_hit_count(device_id, path)
            stats.append(DeviceTokenStats(
                device_id=device_id,
                remaining_tokens=round(bucket.get_remaining(), 1),
                rate_limit=bucket.rate,
                hit_count_5min=hit_count,
            ))
    return stats

def get_hit_time_series() -> List[RateLimitHitTimeSeries]:
    now = time.time()
    series = []
    for i in range(4, -1, -1):
        window_start = now - (i + 1) * 60
        window_end = now - i * 60
        count = 0
        for key, hits in _rate_limit_hits.items():
            count += sum(1 for t in hits if window_start <= t < window_end)
        ts = datetime.utcfromtimestamp(window_start) if hasattr(datetime, 'utcfromtimestamp') else datetime.now()
        series.append(RateLimitHitTimeSeries(
            timestamp=ts.strftime("%H:%M"),
            hit_count=count,
        ))
    return series

def get_top10_limited_devices() -> List[dict]:
    device_hits = {}
    for key, hits in _rate_limit_hits.items():
        device_id = key.rsplit(":", 1)[0] if ":" in key else key
        device_hits[device_id] = device_hits.get(device_id, 0) + len(hits)
    sorted_devices = sorted(device_hits.items(), key=lambda x: x[1], reverse=True)[:10]
    return [{"device_id": d, "hit_count": c} for d, c in sorted_devices]

def is_device_banned(device_id: str, db: Session) -> bool:
    ban = db.query(DeviceBan).filter(DeviceBan.device_id == device_id).first()
    if not ban:
        return False
    if ban.expires_at and ban.expires_at < datetime.utcnow():
        db.delete(ban)
        db.commit()
        return False
    return True

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


# ========== 巡检计划工具函数与调度器 ==========

INSPECTION_TEMPLATES = [
    {
        "season": PlanSeason.SPRING,
        "season_name": "春繁",
        "name": "春繁定期巡检",
        "cron_expression": "0 9 1,15 3,4 *",
        "description": "春季繁殖期，每半月检查一次蜂王产卵、蜂子脾比例和饲料储备",
        "checklist_items": [
            "检查蜂王是否健在、产卵是否正常",
            "查看子脾比例（卵、幼虫、封盖子）",
            "检查饲料储备（蜜、粉）",
            "观察蜂群健康状况，有无病害迹象",
            "记录群势等级",
            "清理箱底杂物",
        ],
    },
    {
        "season": PlanSeason.AUTUMN,
        "season_name": "秋繁",
        "name": "秋繁定期巡检",
        "cron_expression": "0 9 1,15 8,9,10 *",
        "description": "秋季繁殖期，每半月检查越冬蜂培育和饲料储备情况",
        "checklist_items": [
            "检查蜂王产卵情况",
            "查看越冬适龄蜂数量",
            "检查蜜粉储备是否充足",
            "防治蜂螨等病虫害",
            "评估群势是否达标",
            "调整巢脾布局",
        ],
    },
    {
        "season": PlanSeason.WINTER,
        "season_name": "越冬",
        "name": "越冬期巡检",
        "cron_expression": "0 10 1 11,12,1,2 *",
        "description": "越冬期每月检查一次，确保蜂群安全越冬",
        "checklist_items": [
            "听测蜂群声音判断状态",
            "检查饲料消耗情况",
            "观察巢门通风情况",
            "注意保温措施是否到位",
            "防止鼠害等侵扰",
            "记录越冬状态",
        ],
    },
]

_scheduler: Optional[BackgroundScheduler] = None

def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    return _scheduler

def parse_cron_expression(cron_expr: str) -> Optional[CronTrigger]:
    try:
        parts = cron_expr.strip().split()
        if len(parts) < 5:
            return None
        return CronTrigger.from_crontab(cron_expr)
    except Exception:
        return None

def get_next_run_time(cron_expr: str) -> Optional[datetime]:
    trigger = parse_cron_expression(cron_expr)
    if not trigger:
        return None
    try:
        from apscheduler.triggers.cron import CronTrigger
        now = datetime.now()
        next_fire = trigger.get_next_fire_time(None, now)
        return next_fire
    except Exception:
        return None

def validate_cron_expression(cron_expr: str) -> tuple[bool, Optional[str]]:
    try:
        parts = cron_expr.strip().split()
        if len(parts) < 5 or len(parts) > 6:
            return False, f"Cron表达式需要5-6个字段，当前{len(parts)}个"
        trigger = parse_cron_expression(cron_expr)
        if not trigger:
            return False, "Cron表达式格式不正确"
        next_time = get_next_run_time(cron_expr)
        if not next_time:
            return False, "无法计算下一次执行时间"
        return True, None
    except Exception as e:
        return False, str(e)

def get_filtered_hives(db: Session, filter_conditions: dict) -> List[Beehive]:
    query = db.query(Beehive).filter(Beehive.status == "active")
    if not filter_conditions:
        return query.all()
    if "apiary_id" in filter_conditions and filter_conditions["apiary_id"]:
        query = query.filter(Beehive.apiary_id == filter_conditions["apiary_id"])
    if "strength_levels" in filter_conditions and filter_conditions["strength_levels"]:
        levels = filter_conditions["strength_levels"]
        if isinstance(levels, list) and levels:
            query = query.filter(Beehive.strength_level.in_(levels))
    if "bee_species" in filter_conditions and filter_conditions["bee_species"]:
        query = query.filter(Beehive.bee_species == filter_conditions["bee_species"])
    if "min_strength" in filter_conditions and filter_conditions["min_strength"]:
        order = ["weak", "medium", "strong", "very_strong"]
        min_idx = order.index(filter_conditions["min_strength"]) if filter_conditions["min_strength"] in order else 0
        query = query.filter(Beehive.strength_level.in_(order[min_idx:]))
    return query.all()

def parse_filter_conditions(filter_str: str) -> dict:
    if not filter_str:
        return {}
    try:
        return json.loads(filter_str)
    except (json.JSONDecodeError, TypeError):
        return {}

def parse_checklist_items(checklist_str: str) -> List[str]:
    if not checklist_str:
        return []
    try:
        items = json.loads(checklist_str)
        return items if isinstance(items, list) else []
    except (json.JSONDecodeError, TypeError):
        return []

def get_inspection_plan_response_model(plan: InspectionPlan, db: Session) -> InspectionPlanResponse:
    filter_conditions = parse_filter_conditions(plan.filter_conditions)
    checklist_items = parse_checklist_items(plan.checklist_items)
    affected_count = len(get_filtered_hives(db, filter_conditions)) if plan.is_enabled else 0
    return InspectionPlanResponse(
        id=plan.id,
        name=plan.name,
        season=plan.season,
        season_name=SEASON_NAMES.get(plan.season, str(plan.season)),
        cron_expression=plan.cron_expression,
        filter_conditions=filter_conditions,
        checklist_items=checklist_items,
        is_enabled=plan.is_enabled,
        description=plan.description,
        last_run_at=plan.last_run_at,
        next_run_at=get_next_run_time(plan.cron_expression) if plan.is_enabled else None,
        affected_hive_count=affected_count,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )

def get_execution_log_response_model(log: InspectionExecutionLog) -> ExecutionLogResponse:
    duration = None
    if log.started_at and log.finished_at:
        duration = (log.finished_at - log.started_at).total_seconds()
    return ExecutionLogResponse(
        id=log.id,
        plan_id=log.plan_id,
        plan_name=log.plan_name,
        status=log.status,
        status_name=EXECUTION_STATUS_NAMES.get(log.status, str(log.status)),
        total_hives=log.total_hives,
        success_hives=log.success_hives,
        failed_hives=log.failed_hives,
        error_message=log.error_message,
        triggered_by=log.triggered_by,
        started_at=log.started_at,
        finished_at=log.finished_at,
        duration_seconds=duration,
    )

def get_ticket_response_model(ticket: InspectionTicket) -> InspectionTicketResponse:
    checklist_items = parse_checklist_items(ticket.checklist_items)
    checklist_results = None
    if ticket.checklist_results:
        try:
            checklist_results = json.loads(ticket.checklist_results)
        except (json.JSONDecodeError, TypeError):
            checklist_results = None
    return InspectionTicketResponse(
        id=ticket.id,
        plan_id=ticket.plan_id,
        plan_name=ticket.plan_name,
        hive_id=ticket.hive_id,
        hive_code=ticket.hive_code,
        status=ticket.status,
        status_name=PLAN_STATUS_NAMES.get(ticket.status, str(ticket.status)),
        checklist_items=checklist_items,
        checklist_results=checklist_results,
        notes=ticket.notes,
        executed_at=ticket.executed_at,
        created_at=ticket.created_at,
        due_at=ticket.due_at,
    )

def execute_inspection_plan(plan_id: int, triggered_by: str = "scheduler"):
    db = SessionLocal()
    try:
        plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
        if not plan:
            logger.error(f"Inspection plan {plan_id} not found for execution")
            return

        started_at = datetime.utcnow()
        filter_conditions = parse_filter_conditions(plan.filter_conditions)
        checklist_items = plan.checklist_items
        hives = get_filtered_hives(db, filter_conditions)

        total_hives = len(hives)
        success_hives = 0
        failed_hives = 0
        error_msg = None

        try:
            for hive in hives:
                try:
                    ticket = InspectionTicket(
                        plan_id=plan.id,
                        plan_name=plan.name,
                        hive_id=hive.id,
                        hive_code=hive.hive_code,
                        status=PlanStatus.PENDING,
                        checklist_items=checklist_items,
                        created_at=datetime.utcnow(),
                        due_at=datetime.utcnow() + timedelta(days=7),
                    )
                    db.add(ticket)
                    success_hives += 1
                except Exception as e:
                    failed_hives += 1
                    logger.error(f"Failed to create ticket for hive {hive.hive_code}: {e}")

            plan.last_run_at = datetime.utcnow()
            db.commit()

            exec_status = ExecutionStatus.SUCCESS
            if failed_hives > 0 and success_hives == 0:
                exec_status = ExecutionStatus.FAILED
            elif failed_hives > 0:
                exec_status = ExecutionStatus.PARTIAL

            finished_at = datetime.utcnow()
            log_entry = InspectionExecutionLog(
                plan_id=plan.id,
                plan_name=plan.name,
                status=exec_status,
                total_hives=total_hives,
                success_hives=success_hives,
                failed_hives=failed_hives,
                error_message=error_msg,
                triggered_by=triggered_by,
                started_at=started_at,
                finished_at=finished_at,
            )
            db.add(log_entry)
            db.commit()

            logger.info(
                f"Inspection plan '{plan.name}' executed: "
                f"total={total_hives}, success={success_hives}, failed={failed_hives}, "
                f"triggered_by={triggered_by}"
            )
        except Exception as e:
            db.rollback()
            error_msg = str(e)
            finished_at = datetime.utcnow()
            log_entry = InspectionExecutionLog(
                plan_id=plan.id,
                plan_name=plan.name,
                status=ExecutionStatus.FAILED,
                total_hives=total_hives,
                success_hives=success_hives,
                failed_hives=total_hives - success_hives,
                error_message=error_msg,
                triggered_by=triggered_by,
                started_at=started_at,
                finished_at=finished_at,
            )
            db.add(log_entry)
            db.commit()
            logger.error(f"Inspection plan '{plan.name}' execution failed: {e}")
    finally:
        db.close()

def schedule_plan(plan: InspectionPlan):
    scheduler = get_scheduler()
    job_id = f"inspection_plan_{plan.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    if not plan.is_enabled:
        return
    trigger = parse_cron_expression(plan.cron_expression)
    if not trigger:
        logger.warning(f"Invalid cron expression for plan {plan.id}: {plan.cron_expression}")
        return
    scheduler.add_job(
        execute_inspection_plan,
        trigger=trigger,
        id=job_id,
        args=[plan.id, "scheduler"],
        replace_existing=True,
    )
    logger.info(f"Scheduled inspection plan '{plan.name}' (id={plan.id}) with cron: {plan.cron_expression}")

def unschedule_plan(plan_id: int):
    scheduler = get_scheduler()
    job_id = f"inspection_plan_{plan_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info(f"Unscheduled inspection plan id={plan_id}")

def init_scheduler():
    scheduler = get_scheduler()
    db = SessionLocal()
    try:
        plans = db.query(InspectionPlan).filter(InspectionPlan.is_enabled == True).all()
        for plan in plans:
            schedule_plan(plan)
        scheduler.start()
        logger.info(f"Scheduler initialized with {len(plans)} active inspection plans")
    except Exception as e:
        logger.error(f"Failed to initialize scheduler: {e}")
    finally:
        db.close()

# ========== API Key 工具函数 ==========
import secrets
import hashlib

def generate_api_key() -> tuple:
    prefix = "pm-" + secrets.token_hex(API_KEY_PREFIX_LENGTH // 2)
    secret = secrets.token_hex(API_KEY_SECRET_LENGTH // 2)
    full_key = f"{prefix}.{secret}"
    hashed = hashlib.sha256(full_key.encode()).hexdigest()
    return prefix, full_key, hashed

def hash_api_key(full_key: str) -> str:
    return hashlib.sha256(full_key.encode()).hexdigest()

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _extract_request_device_id(request: Request) -> Optional[str]:
    device_id = request.headers.get("X-Device-Id")
    if device_id:
        return device_id
    try:
        body = getattr(request.state, "_body_json", None)
        if body and isinstance(body, dict) and "device_id" in body:
            return str(body["device_id"])
    except Exception:
        pass
    return None

def _parse_scopes(scopes_json: str) -> List[str]:
    try:
        parsed = json.loads(scopes_json)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []

def _get_scope_names(scopes: List[str]) -> List[str]:
    names = []
    for s in scopes:
        try:
            scope_enum = ApiKeyScope(s)
            names.append(SCOPE_NAMES.get(scope_enum, s))
        except Exception:
            names.append(s)
    return names

def _check_scope_permission(scopes: List[str], required_scope: str) -> bool:
    if ApiKeyScope.ALL.value in scopes:
        return True
    return required_scope in scopes

SCOPE_PATH_MAP = {
    "GET": [
        (r"^/api/hives($|/.*)", ApiKeyScope.HIVES_READ.value),
        (r"^/api/sensor-data($|/.*)", ApiKeyScope.SENSOR_READ.value),
        (r"^/api/operation-logs($|/.*)", ApiKeyScope.OPERATION_LOGS_READ.value),
        (r"^/api/inspection-plans($|/.*)", ApiKeyScope.INSPECTION_PLANS_READ.value),
    ],
    "POST": [
        (r"^/api/sensor-data($|/.*)", ApiKeyScope.SENSOR_WRITE.value),
        (r"^/api/hives($|/.*)", ApiKeyScope.HIVES_WRITE.value),
        (r"^/api/inspection-plans($|/.*)", ApiKeyScope.INSPECTION_PLANS_WRITE.value),
    ],
    "PUT": [
        (r"^/api/hives($|/.*)", ApiKeyScope.HIVES_WRITE.value),
        (r"^/api/inspection-plans($|/.*)", ApiKeyScope.INSPECTION_PLANS_WRITE.value),
    ],
    "DELETE": [
        (r"^/api/hives($|/.*)", ApiKeyScope.HIVES_WRITE.value),
    ],
    "PATCH": [
        (r"^/api/hives($|/.*)", ApiKeyScope.HIVES_WRITE.value),
        (r"^/api/inspection-plans($|/.*)", ApiKeyScope.INSPECTION_PLANS_WRITE.value),
    ],
}

def _check_path_scope(method: str, path: str, scopes: List[str]) -> bool:
    if ApiKeyScope.ALL.value in scopes:
        return True
    method_rules = SCOPE_PATH_MAP.get(method.upper(), [])
    matched_any = False
    for pattern, required in method_rules:
        if re.match(pattern, path):
            matched_any = True
            if required in scopes:
                return True
    return not matched_any

def _make_api_key_response(key: ApiKey) -> ApiKeyResponse:
    scopes = _parse_scopes(key.scopes)
    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=scopes,
        scope_names=_get_scope_names(scopes),
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        bound_device_id=key.bound_device_id,
        issuer_id=key.issuer_id,
        issuer_username=key.issuer.username if key.issuer else "unknown",
        is_revoked=key.is_revoked,
        revoked_at=key.revoked_at,
        created_at=key.created_at,
    )


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

# API Key 认证中间件
@app.middleware("http")
async def api_key_auth_middleware(request: Request, call_next):
    api_key_header = request.headers.get(API_KEY_HEADER)
    status_code = 500
    api_key_obj = None
    scope_violation = False
    device_mismatch = False
    auth_via_apikey = False

    if api_key_header and request.url.path.startswith("/api/"):
        db = SessionLocal()
        try:
            hashed = hash_api_key(api_key_header.strip())
            api_key_obj = db.query(ApiKey).filter(
                ApiKey.hashed_key == hashed,
                ApiKey.is_revoked == False
            ).first()

            if not api_key_obj:
                response = JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "无效的 API Key"}
                )
                status_code = 401
            elif api_key_obj.expires_at and api_key_obj.expires_at < datetime.utcnow():
                response = JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"detail": "API Key 已过期"}
                )
                status_code = 401
            else:
                scopes = _parse_scopes(api_key_obj.scopes)
                if not _check_path_scope(request.method, request.url.path, scopes):
                    scope_violation = True
                    response = JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": "API Key 权限不足，无法访问此接口"}
                    )
                    status_code = 403
                else:
                    request_device_id = _extract_request_device_id(request)
                    if api_key_obj.bound_device_id and request_device_id:
                        if api_key_obj.bound_device_id != request_device_id:
                            device_mismatch = True
                            response = JSONResponse(
                                status_code=status.HTTP_403_FORBIDDEN,
                                content={"detail": f"API Key 已绑定设备 {api_key_obj.bound_device_id}，当前设备 {request_device_id} 不匹配"}
                            )
                            status_code = 403
                        else:
                            auth_via_apikey = True
                            request.state.api_key = api_key_obj
                            request.state.api_key_scopes = scopes
                            response = await call_next(request)
                            status_code = response.status_code
                    else:
                        auth_via_apikey = True
                        request.state.api_key = api_key_obj
                        request.state.api_key_scopes = scopes
                        response = await call_next(request)
                        status_code = response.status_code
        except Exception as e:
            logger.error(f"API Key auth error: {e}")
            response = JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": "API Key 认证异常"}
            )
            status_code = 500
        finally:
            if api_key_obj and not (scope_violation and status_code == 403) and not (device_mismatch and status_code == 403):
                try:
                    api_key_obj.last_used_at = datetime.utcnow()
                    call_log = ApiKeyCallLog(
                        api_key_id=api_key_obj.id,
                        path=request.url.path,
                        method=request.method,
                        status_code=status_code,
                        source_ip=_get_client_ip(request),
                        device_id=_extract_request_device_id(request),
                        user_agent=request.headers.get("User-Agent"),
                    )
                    db.add(call_log)
                    db.commit()
                except Exception as log_err:
                    logger.error(f"Failed to log API Key call: {log_err}")
                    db.rollback()
            db.close()
        return response

    response = await call_next(request)
    return response


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
    init_scheduler()
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


# ============ 巡检计划接口 ============

@app.get("/api/inspection-plans/templates", response_model=List[InspectionTemplateResponse])
async def get_inspection_templates(
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取春繁/秋繁/越冬三套巡检计划模板"""
    return [
        InspectionTemplateResponse(
            season=t["season"],
            season_name=t["season_name"],
            name=t["name"],
            cron_expression=t["cron_expression"],
            description=t["description"],
            checklist_items=t["checklist_items"],
        )
        for t in INSPECTION_TEMPLATES
    ]

@app.get("/api/inspection-plans/parse-cron", response_model=CronParseResponse)
async def parse_cron(
    cron_expression: str,
    current_user: User = Depends(require_permissions(["read"])),
):
    """解析Cron表达式，验证有效性并返回下一次执行时间"""
    is_valid, error_message = validate_cron_expression(cron_expression)
    next_run_at = get_next_run_time(cron_expression) if is_valid else None
    return CronParseResponse(
        cron_expression=cron_expression,
        is_valid=is_valid,
        next_run_at=next_run_at,
        error_message=error_message,
    )

@app.get("/api/inspection-plans", response_model=InspectionPlanListResponse)
async def list_inspection_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取所有巡检计划列表"""
    plans = db.query(InspectionPlan).order_by(InspectionPlan.created_at.desc()).all()
    return InspectionPlanListResponse(
        items=[get_inspection_plan_response_model(p, db) for p in plans],
        total=len(plans),
    )

@app.get("/api/inspection-plans/{plan_id}", response_model=InspectionPlanResponse)
async def get_inspection_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取单个巡检计划详情"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")
    return get_inspection_plan_response_model(plan, db)

@app.post("/api/inspection-plans", response_model=InspectionPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_inspection_plan(
    plan_data: InspectionPlanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """创建巡检计划"""
    is_valid, error_msg = validate_cron_expression(plan_data.cron_expression)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Cron表达式无效: {error_msg}")

    plan = InspectionPlan(
        name=plan_data.name,
        season=plan_data.season,
        cron_expression=plan_data.cron_expression,
        filter_conditions=json.dumps(plan_data.filter_conditions, ensure_ascii=False),
        checklist_items=json.dumps(plan_data.checklist_items, ensure_ascii=False),
        is_enabled=plan_data.is_enabled,
        description=plan_data.description,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    if plan.is_enabled:
        schedule_plan(plan)

    logger.info(f"Inspection plan created by {current_user.username}: {plan.name}")
    return get_inspection_plan_response_model(plan, db)

@app.put("/api/inspection-plans/{plan_id}", response_model=InspectionPlanResponse)
async def update_inspection_plan(
    plan_id: int,
    update_data: InspectionPlanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """更新巡检计划"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")

    update_dict = update_data.model_dump(exclude_unset=True)

    if "cron_expression" in update_dict:
        is_valid, error_msg = validate_cron_expression(update_dict["cron_expression"])
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Cron表达式无效: {error_msg}")

    was_enabled = plan.is_enabled

    for key, value in update_dict.items():
        if key == "filter_conditions":
            setattr(plan, key, json.dumps(value, ensure_ascii=False))
        elif key == "checklist_items":
            setattr(plan, key, json.dumps(value, ensure_ascii=False))
        else:
            setattr(plan, key, value)

    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    if "is_enabled" in update_dict or "cron_expression" in update_dict:
        if plan.is_enabled:
            schedule_plan(plan)
        else:
            unschedule_plan(plan.id)

    logger.info(f"Inspection plan updated by {current_user.username}: {plan.name}")
    return get_inspection_plan_response_model(plan, db)

@app.delete("/api/inspection-plans/{plan_id}")
async def delete_inspection_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    """删除巡检计划"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")

    unschedule_plan(plan.id)
    db.delete(plan)
    db.commit()

    logger.info(f"Inspection plan deleted by {current_user.username}: {plan.name}")
    return {"message": "删除成功", "id": plan_id}

@app.post("/api/inspection-plans/{plan_id}/toggle", response_model=InspectionPlanResponse)
async def toggle_inspection_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """切换巡检计划启用/禁用状态"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")

    plan.is_enabled = not plan.is_enabled
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    if plan.is_enabled:
        schedule_plan(plan)
    else:
        unschedule_plan(plan.id)

    action = "enabled" if plan.is_enabled else "disabled"
    logger.info(f"Inspection plan {action} by {current_user.username}: {plan.name}")
    return get_inspection_plan_response_model(plan, db)

@app.post("/api/inspection-plans/{plan_id}/trigger")
async def trigger_inspection_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """手动立即触发巡检计划执行"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")

    import threading
    thread = threading.Thread(
        target=execute_inspection_plan,
        args=(plan.id, f"manual:{current_user.username}"),
        daemon=True,
    )
    thread.start()

    logger.info(f"Inspection plan manually triggered by {current_user.username}: {plan.name}")
    return {"message": "已触发执行，请稍后查看执行历史", "plan_id": plan_id}

@app.get("/api/inspection-plans/{plan_id}/tickets")
async def list_plan_tickets(
    plan_id: int,
    page: int = 1,
    size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取巡检计划生成的工单列表"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡检计划不存在")

    query = db.query(InspectionTicket).filter(InspectionTicket.plan_id == plan_id)
    total = query.count()
    query = query.order_by(InspectionTicket.created_at.desc())
    offset = (page - 1) * size
    tickets = query.offset(offset).limit(size).all()

    return {
        "items": [get_ticket_response_model(t) for t in tickets],
        "total": total,
        "page": page,
        "size": size,
    }

@app.get("/api/inspection-execution-logs", response_model=ExecutionLogListResponse)
async def list_execution_logs(
    limit: int = 50,
    plan_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取执行历史日志，默认返回最近50条"""
    query = db.query(InspectionExecutionLog)
    if plan_id:
        query = query.filter(InspectionExecutionLog.plan_id == plan_id)
    query = query.order_by(InspectionExecutionLog.started_at.desc())
    logs = query.limit(max(1, min(limit, 200))).all()
    return ExecutionLogListResponse(
        items=[get_execution_log_response_model(log) for log in logs],
        total=len(logs),
    )


# ============ 传感器流控与限流监控接口 ============

@app.post("/api/sensor-data")
async def submit_sensor_data(
    data: SensorDataRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if is_device_banned(data.device_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"设备 {data.device_id} 已被封禁，请联系管理员",
        )
    ip_str = get_client_ip(request)
    allowed, error_msg, remaining = check_rate_limit(data.device_id, "/api/sensor-data", ip_str, db)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"message": error_msg, "retry_after": 60, "device_id": data.device_id},
        )
    logger.info(f"Sensor data received from device {data.device_id}: temp={data.temperature}, humidity={data.humidity}, weight={data.weight}")
    return {
        "status": "accepted",
        "device_id": data.device_id,
        "remaining_tokens": remaining,
        "message": "传感器数据已接收",
    }


@app.get("/api/rate-limit/rules", response_model=List[RateLimitRuleResponse])
async def list_rate_limit_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    rules = db.query(RateLimitRule).order_by(RateLimitRule.created_at.desc()).all()
    return rules


@app.post("/api/rate-limit/rules", response_model=RateLimitRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rate_limit_rule(
    data: RateLimitRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    rule = RateLimitRule(
        name=data.name,
        path_pattern=data.path_pattern,
        device_id_pattern=data.device_id_pattern,
        ip_range=data.ip_range,
        rate_limit=data.rate_limit,
        burst=data.burst,
        is_enabled=data.is_enabled,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    logger.info(f"Rate limit rule created by {current_user.username}: {rule.name}")
    return rule


@app.put("/api/rate-limit/rules/{rule_id}", response_model=RateLimitRuleResponse)
async def update_rate_limit_rule(
    rule_id: int,
    data: RateLimitRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    rule = db.query(RateLimitRule).filter(RateLimitRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="限流规则不存在")
    update_dict = data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(rule, key, value)
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    logger.info(f"Rate limit rule updated by {current_user.username}: {rule.name}")
    return rule


@app.post("/api/rate-limit/rules/{rule_id}/toggle", response_model=RateLimitRuleResponse)
async def toggle_rate_limit_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    rule = db.query(RateLimitRule).filter(RateLimitRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="限流规则不存在")
    rule.is_enabled = not rule.is_enabled
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    logger.info(f"Rate limit rule toggled by {current_user.username}: {rule.name} -> {'enabled' if rule.is_enabled else 'disabled'}")
    return rule


@app.delete("/api/rate-limit/rules/{rule_id}")
async def delete_rate_limit_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    rule = db.query(RateLimitRule).filter(RateLimitRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="限流规则不存在")
    db.delete(rule)
    db.commit()
    logger.info(f"Rate limit rule deleted by {current_user.username}: {rule.name}")
    return {"message": "规则已删除"}


@app.get("/api/rate-limit/stats")
async def get_rate_limit_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    device_stats = get_all_device_stats(db)
    time_series = get_hit_time_series()
    top10 = get_top10_limited_devices()
    banned_devices = db.query(DeviceBan).all()
    active_bans = []
    for ban in banned_devices:
        if ban.expires_at and ban.expires_at < datetime.utcnow():
            db.delete(ban)
            continue
        active_bans.append(DeviceBanResponse(
            id=ban.id,
            device_id=ban.device_id,
            reason=ban.reason,
            banned_at=ban.banned_at,
            expires_at=ban.expires_at,
            is_active=True,
        ))
    db.commit()
    return {
        "device_stats": device_stats,
        "hit_time_series": time_series,
        "top10_limited": top10,
        "banned_devices": active_bans,
    }


@app.post("/api/rate-limit/ban")
async def ban_device(
    data: DeviceBanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    existing = db.query(DeviceBan).filter(DeviceBan.device_id == data.device_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="设备已被封禁")
    expires_at = None
    if data.duration_minutes:
        expires_at = datetime.utcnow() + timedelta(minutes=data.duration_minutes)
    ban = DeviceBan(
        device_id=data.device_id,
        reason=data.reason or "管理员手动封禁",
        banned_at=datetime.utcnow(),
        expires_at=expires_at,
        banned_by=current_user.id,
    )
    db.add(ban)
    db.commit()
    logger.info(f"Device banned by {current_user.username}: {data.device_id}")
    return {"message": f"设备 {data.device_id} 已被封禁", "device_id": data.device_id}


@app.delete("/api/rate-limit/ban/{device_id}")
async def unban_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    ban = db.query(DeviceBan).filter(DeviceBan.device_id == device_id).first()
    if not ban:
        raise HTTPException(status_code=404, detail="封禁记录不存在")
    db.delete(ban)
    db.commit()
    logger.info(f"Device unbanned by {current_user.username}: {device_id}")
    return {"message": f"设备 {device_id} 已解封"}


# ============ API Key 管理接口 ============

@app.get("/api/api-keys/scopes", response_model=ApiKeyScopesResponse)
async def list_api_key_scopes(
    current_user: User = Depends(require_permissions(["read"])),
):
    scopes_list = []
    for scope in ApiKeyScope:
        scopes_list.append({
            "value": scope.value,
            "name": SCOPE_NAMES.get(scope, scope.value),
        })
    return {"scopes": scopes_list}


@app.post("/api/api-keys", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    data: ApiKeyCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    prefix, full_key, hashed = generate_api_key()
    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)

    scopes_json = json.dumps(data.scopes, ensure_ascii=False)
    new_key = ApiKey(
        name=data.name,
        key_prefix=prefix,
        hashed_key=hashed,
        scopes=scopes_json,
        expires_at=expires_at,
        bound_device_id=data.bound_device_id,
        issuer_id=current_user.id,
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)

    logger.info(f"API Key created by {current_user.username}: name={data.name}, prefix={prefix}")

    scope_names = _get_scope_names(data.scopes)
    return ApiKeyCreatedResponse(
        id=new_key.id,
        name=new_key.name,
        key_prefix=prefix,
        full_key=full_key,
        scopes=data.scopes,
        scope_names=scope_names,
        expires_at=expires_at,
        bound_device_id=data.bound_device_id,
        created_at=new_key.created_at,
    )


@app.get("/api/api-keys", response_model=ApiKeyListResponse)
async def list_api_keys(
    include_revoked: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    query = db.query(ApiKey).filter(ApiKey.issuer_id == current_user.id)
    if not include_revoked:
        query = query.filter(ApiKey.is_revoked == False)
    keys = query.order_by(ApiKey.created_at.desc()).all()
    items = [_make_api_key_response(k) for k in keys]
    return {"items": items, "total": len(items)}


@app.delete("/api/api-keys/{key_id}", response_model=ApiKeyRevokeResponse)
async def revoke_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.issuer_id == current_user.id
    ).first()
    if not key:
        raise HTTPException(status_code=404, detail="凭证不存在")
    if key.is_revoked:
        raise HTTPException(status_code=400, detail="凭证已被吊销")

    key.is_revoked = True
    key.revoked_at = datetime.utcnow()
    key.revoked_by = current_user.id
    db.commit()

    logger.info(f"API Key revoked by {current_user.username}: id={key_id}, prefix={key.key_prefix}")
    return ApiKeyRevokeResponse(message="凭证已成功吊销", id=key_id)


@app.get("/api/api-keys/{key_id}/call-logs", response_model=ApiKeyCallLogListResponse)
async def get_api_key_call_logs(
    key_id: int,
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.issuer_id == current_user.id
    ).first()
    if not key:
        raise HTTPException(status_code=404, detail="凭证不存在")

    query = db.query(ApiKeyCallLog).filter(ApiKeyCallLog.api_key_id == key_id)
    total = query.count()
    logs = query.order_by(ApiKeyCallLog.created_at.desc()) \
        .offset((page - 1) * size) \
        .limit(size) \
        .all()

    items = [
        ApiKeyCallLogResponse(
            id=log.id,
            path=log.path,
            method=log.method,
            status_code=log.status_code,
            source_ip=log.source_ip,
            device_id=log.device_id,
            user_agent=log.user_agent,
            created_at=log.created_at,
        )
        for log in logs
    ]
    return {"items": items, "total": total}


# ============ WebSocket 连接管理器 ============
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if len(self.active_connections[user_id]) == 0:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_json(message)
                except Exception:
                    pass

    async def broadcast(self, message: dict):
        for user_id in list(self.active_connections.keys()):
            await self.send_personal_message(message, user_id)


ws_manager = ConnectionManager()


def _make_notification_response(notification: Notification) -> NotificationResponse:
    extra_data = None
    if notification.extra_data:
        try:
            extra_data = json.loads(notification.extra_data)
        except Exception:
            extra_data = None
    return NotificationResponse(
        id=notification.id,
        user_id=notification.user_id,
        category=notification.category,
        category_name=MESSAGE_CATEGORY_NAMES.get(notification.category, notification.category.value),
        title=notification.title,
        content=notification.content,
        severity=notification.severity,
        severity_name=SEVERITY_LEVEL_NAMES.get(notification.severity, notification.severity.value),
        is_read=notification.is_read,
        source=notification.source,
        related_id=notification.related_id,
        extra_data=extra_data,
        created_at=notification.created_at,
        read_at=notification.read_at,
    )


async def _notify_user_via_ws(notification: Notification):
    resp = _make_notification_response(notification)
    await ws_manager.send_personal_message(
        {"type": "new_notification", "data": resp.model_dump()},
        notification.user_id,
    )


def _dispatch_notifications_sync(
    db: Session,
    category: MessageCategory,
    title: str,
    content: str,
    severity: SeverityLevel = SeverityLevel.INFO,
    source: Optional[str] = None,
    related_id: Optional[int] = None,
    extra_data: Optional[Dict] = None,
    user_ids: Optional[List[int]] = None,
    target_roles: Optional[List[UserRole]] = None,
    target_farm_ids: Optional[List[str]] = None,
) -> List[Notification]:
    query = db.query(User)
    target_users = []

    if user_ids and len(user_ids) > 0:
        target_users = query.filter(User.id.in_(user_ids)).all()
    else:
        if target_roles and len(target_roles) > 0:
            query = query.filter(User.role.in_(target_roles))
        users = query.all()
        if target_farm_ids and len(target_farm_ids) > 0:
            for u in users:
                try:
                    farm_scope = json.loads(u.farm_scope) if u.farm_scope else []
                except Exception:
                    farm_scope = []
                if any(fid in farm_scope for fid in target_farm_ids):
                    target_users.append(u)
        else:
            target_users = users

    extra_json = json.dumps(extra_data, ensure_ascii=False) if extra_data else None
    created = []
    for user in target_users:
        notification = Notification(
            user_id=user.id,
            category=category,
            title=title,
            content=content,
            severity=severity,
            is_read=False,
            source=source,
            related_id=related_id,
            extra_data=extra_json,
            created_at=datetime.utcnow(),
        )
        db.add(notification)
        created.append(notification)
    db.commit()
    for n in created:
        db.refresh(n)
    return created


# ============ 消息中心 API ============

@app.get("/api/notifications", response_model=NotificationListResponse)
async def list_notifications(
    category: Optional[MessageCategory] = None,
    only_unread: bool = False,
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if category:
        query = query.filter(Notification.category == category)
    if only_unread:
        query = query.filter(Notification.is_read == False)

    total = query.count()
    unread_count = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).count()

    notifications = query.order_by(Notification.created_at.desc()) \
        .offset((page - 1) * size) \
        .limit(size) \
        .all()

    return NotificationListResponse(
        items=[_make_notification_response(n) for n in notifications],
        total=total,
        unread_count=unread_count,
    )


@app.get("/api/notifications/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    )
    total = query.count()
    by_category = {}
    for cat in MessageCategory:
        cnt = db.query(Notification).filter(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
            Notification.category == cat,
        ).count()
        by_category[cat.value] = cnt
    return UnreadCountResponse(total=total, by_category=by_category)


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="消息不存在")
    notification.is_read = True
    notification.read_at = datetime.utcnow()
    db.commit()
    db.refresh(notification)
    return {"message": "已标记为已读", "notification": _make_notification_response(notification)}


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(
    category: Optional[MessageCategory] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    )
    if category:
        query = query.filter(Notification.category == category)
    now = datetime.utcnow()
    count = query.update(
        {Notification.is_read: True, Notification.read_at: now},
        synchronize_session=False,
    )
    db.commit()
    return {"message": f"已标记 {count} 条消息为已读", "count": count}


@app.delete("/api/notifications/{notification_id}")
async def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(status_code=404, detail="消息不存在")
    db.delete(notification)
    db.commit()
    return {"message": "消息已删除"}


@app.post("/api/internal/notifications/dispatch")
async def dispatch_notification(
    data: NotificationDispatchRequest,
    db: Session = Depends(get_db),
):
    created = _dispatch_notifications_sync(
        db=db,
        category=data.category,
        title=data.title,
        content=data.content,
        severity=data.severity,
        source=data.source,
        related_id=data.related_id,
        extra_data=data.extra_data,
        user_ids=data.user_ids,
        target_roles=data.target_roles,
        target_farm_ids=data.target_farm_ids,
    )
    for notification in created:
        await _notify_user_via_ws(notification)
    logger.info(f"Dispatched {len(created)} notifications: category={data.category.value}, severity={data.severity.value}")
    return {
        "message": f"已分发 {len(created)} 条消息",
        "count": len(created),
        "notification_ids": [n.id for n in created],
    }


@app.websocket("/ws/notifications")
async def websocket_notifications(websocket: WebSocket, token: Optional[str] = None):
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user_id: Optional[int] = payload.get("user_id")
        if user_id is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, user_id)
    except Exception:
        ws_manager.disconnect(websocket, user_id)


# ============ 工具函数 ============

def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    使用Haversine公式计算两点之间的直线距离（公里）
    """
    import math
    R = 6371.0  # 地球半径（公里）

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = math.sin(delta_lat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * \
        math.sin(delta_lng / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def _get_nectar_calendar_response(item: NectarCalendar) -> NectarCalendarResponse:
    return NectarCalendarResponse(
        id=item.id,
        plant_type=item.plant_type,
        plant_type_name=NECTAR_PLANT_NAMES.get(item.plant_type, item.plant_type.value),
        plant_name=item.plant_name,
        location_name=item.location_name,
        location_lat=item.location_lat,
        location_lng=item.location_lng,
        bloom_start_date=item.bloom_start_date,
        bloom_end_date=item.bloom_end_date,
        max_hive_capacity=item.max_hive_capacity,
        nectar_quality=item.nectar_quality,
        notes=item.notes,
        created_by=item.created_by,
        created_by_username=item.created_by_username,
        created_at=item.created_at,
        updated_at=item.updated_at,
        color=NECTAR_PLANT_COLORS.get(item.plant_type, "#808080"),
    )


def _get_relocation_plan_response(plan: RelocationPlan) -> RelocationPlanResponse:
    try:
        beekeepers = json.loads(plan.beekeepers) if plan.beekeepers else []
    except Exception:
        beekeepers = []
    try:
        hive_list = json.loads(plan.hive_list) if plan.hive_list else []
    except Exception:
        hive_list = []

    return RelocationPlanResponse(
        id=plan.id,
        plan_name=plan.plan_name,
        source_apiary_id=plan.source_apiary_id,
        source_location_name=plan.source_location_name,
        source_lat=plan.source_lat,
        source_lng=plan.source_lng,
        destination_apiary_id=plan.destination_apiary_id,
        destination_location_name=plan.destination_location_name,
        destination_lat=plan.destination_lat,
        destination_lng=plan.destination_lng,
        departure_date=plan.departure_date,
        estimated_arrival_date=plan.estimated_arrival_date,
        transport_vehicle=plan.transport_vehicle,
        distance_km=plan.distance_km,
        beekeepers=beekeepers,
        hive_list=hive_list,
        status=plan.status,
        status_name=RELOCATION_STATUS_NAMES.get(plan.status, plan.status.value),
        notes=plan.notes,
        created_by=plan.created_by,
        created_by_username=plan.created_by_username,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        completed_at=plan.completed_at,
    )


def _get_relocation_log_response(log: RelocationLog) -> RelocationLogResponse:
    try:
        context_data = json.loads(log.context_data) if log.context_data else {}
    except Exception:
        context_data = {}

    return RelocationLogResponse(
        id=log.id,
        plan_id=log.plan_id,
        hive_id=log.hive_id,
        hive_code=log.hive_code,
        source_apiary_id=log.source_apiary_id,
        destination_apiary_id=log.destination_apiary_id,
        operator_id=log.operator_id,
        operator_username=log.operator_username,
        context_data=context_data,
        description=log.description,
        created_at=log.created_at,
    )


# ============ 蜜源花期日历接口 ============

@app.get("/api/nectar-calendars", response_model=NectarCalendarListResponse)
async def list_nectar_calendars(
    page: int = 1,
    size: int = 20,
    plant_type: Optional[NectarPlantType] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lng: Optional[float] = None,
    max_lng: Optional[float] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取蜜源花期日历列表，支持按时间窗口和地图视野范围检索"""
    query = db.query(NectarCalendar)

    if plant_type:
        query = query.filter(NectarCalendar.plant_type == plant_type)

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(NectarCalendar.bloom_end_date >= start_dt)
        except Exception:
            pass

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            query = query.filter(NectarCalendar.bloom_start_date <= end_dt)
        except Exception:
            pass

    if min_lat is not None:
        query = query.filter(NectarCalendar.location_lat >= min_lat)
    if max_lat is not None:
        query = query.filter(NectarCalendar.location_lat <= max_lat)
    if min_lng is not None:
        query = query.filter(NectarCalendar.location_lng >= min_lng)
    if max_lng is not None:
        query = query.filter(NectarCalendar.location_lng <= max_lng)

    total = query.count()
    query = query.order_by(NectarCalendar.bloom_start_date.asc())
    offset = (page - 1) * size
    items = query.offset(offset).limit(size).all()

    return {
        "items": [_get_nectar_calendar_response(item) for item in items],
        "total": total,
        "page": page,
        "size": size,
    }


@app.get("/api/nectar-calendars/{calendar_id}", response_model=NectarCalendarResponse)
async def get_nectar_calendar(
    calendar_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取单个蜜源花期日历详情"""
    item = db.query(NectarCalendar).filter(NectarCalendar.id == calendar_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="花期日历不存在")
    return _get_nectar_calendar_response(item)


@app.post("/api/nectar-calendars", response_model=NectarCalendarResponse, status_code=status.HTTP_201_CREATED)
async def create_nectar_calendar(
    data: NectarCalendarCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """创建蜜源花期日历"""
    if data.bloom_start_date >= data.bloom_end_date:
        raise HTTPException(status_code=400, detail="开花开始日期必须早于结束日期")

    item = NectarCalendar(
        plant_type=data.plant_type,
        plant_name=data.plant_name,
        location_name=data.location_name,
        location_lat=data.location_lat,
        location_lng=data.location_lng,
        bloom_start_date=data.bloom_start_date,
        bloom_end_date=data.bloom_end_date,
        max_hive_capacity=data.max_hive_capacity,
        nectar_quality=data.nectar_quality,
        notes=data.notes,
        created_by=current_user.id,
        created_by_username=current_user.username,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    logger.info(f"Nectar calendar created by {current_user.username}: {item.plant_name}")
    return _get_nectar_calendar_response(item)


@app.put("/api/nectar-calendars/{calendar_id}", response_model=NectarCalendarResponse)
async def update_nectar_calendar(
    calendar_id: int,
    data: NectarCalendarUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """更新蜜源花期日历"""
    item = db.query(NectarCalendar).filter(NectarCalendar.id == calendar_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="花期日历不存在")

    update_dict = data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(item, key, value)
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)

    logger.info(f"Nectar calendar updated by {current_user.username}: {item.plant_name}")
    return _get_nectar_calendar_response(item)


@app.delete("/api/nectar-calendars/{calendar_id}")
async def delete_nectar_calendar(
    calendar_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    """删除蜜源花期日历"""
    item = db.query(NectarCalendar).filter(NectarCalendar.id == calendar_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="花期日历不存在")

    db.delete(item)
    db.commit()
    logger.info(f"Nectar calendar deleted by {current_user.username}: {item.plant_name}")
    return {"message": "花期日历已删除"}


@app.get("/api/nectar-calendars/meta/plant-types")
async def get_nectar_plant_types(
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取蜜源植物类型列表"""
    types_list = []
    for plant_type in NectarPlantType:
        types_list.append({
            "value": plant_type.value,
            "name": NECTAR_PLANT_NAMES.get(plant_type, plant_type.value),
            "color": NECTAR_PLANT_COLORS.get(plant_type, "#808080"),
        })
    return {"plant_types": types_list}


# ============ 距离估算接口 ============

@app.get("/api/relocation/estimate-distance", response_model=DistanceEstimateResponse)
async def estimate_distance(
    source_lat: float,
    source_lng: float,
    destination_lat: float,
    destination_lng: float,
    departure_time: Optional[str] = None,
    average_speed_kmh: float = 60.0,
    current_user: User = Depends(require_permissions(["read"])),
):
    """估算两点之间的直线距离和预计到达时间"""
    distance_km = haversine_distance(source_lat, source_lng, destination_lat, destination_lng)
    estimated_duration_hours = distance_km / average_speed_kmh if average_speed_kmh > 0 else 0

    estimated_arrival_time = None
    if departure_time:
        try:
            departure_dt = datetime.fromisoformat(departure_time)
            estimated_arrival_time = departure_dt + timedelta(hours=estimated_duration_hours)
        except Exception:
            pass

    return {
        "distance_km": round(distance_km, 2),
        "estimated_duration_hours": round(estimated_duration_hours, 2),
        "estimated_arrival_time": estimated_arrival_time,
    }


# ============ 转场计划接口 ============

@app.get("/api/relocation-plans", response_model=RelocationPlanListResponse)
async def list_relocation_plans(
    page: int = 1,
    size: int = 20,
    status: Optional[RelocationStatus] = None,
    source_apiary_id: Optional[str] = None,
    destination_apiary_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取转场计划列表"""
    query = db.query(RelocationPlan)

    if status:
        query = query.filter(RelocationPlan.status == status)
    if source_apiary_id:
        query = query.filter(RelocationPlan.source_apiary_id == source_apiary_id)
    if destination_apiary_id:
        query = query.filter(RelocationPlan.destination_apiary_id == destination_apiary_id)

    total = query.count()
    query = query.order_by(RelocationPlan.departure_date.desc())
    offset = (page - 1) * size
    plans = query.offset(offset).limit(size).all()

    return {
        "items": [_get_relocation_plan_response(plan) for plan in plans],
        "total": total,
        "page": page,
        "size": size,
    }


@app.get("/api/relocation-plans/{plan_id}", response_model=RelocationPlanResponse)
async def get_relocation_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取单个转场计划详情"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")
    return _get_relocation_plan_response(plan)


@app.post("/api/relocation-plans", response_model=RelocationPlanResponse, status_code=status.HTTP_201_CREATED)
async def create_relocation_plan(
    data: RelocationPlanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["create"])),
):
    """创建转场计划"""
    if data.distance_km is None:
        distance_km = haversine_distance(
            data.source_lat, data.source_lng,
            data.destination_lat, data.destination_lng
        )
    else:
        distance_km = data.distance_km

    if data.estimated_arrival_date is None and data.departure_date:
        avg_speed = 60.0
        duration_hours = distance_km / avg_speed if avg_speed > 0 else 0
        estimated_arrival = data.departure_date + timedelta(hours=duration_hours)
    else:
        estimated_arrival = data.estimated_arrival_date

    beekeepers_json = json.dumps(data.beekeepers, ensure_ascii=False)
    hive_list_json = json.dumps(
        [h.model_dump() for h in data.hive_list],
        ensure_ascii=False
    )

    plan = RelocationPlan(
        plan_name=data.plan_name,
        source_apiary_id=data.source_apiary_id,
        source_location_name=data.source_location_name,
        source_lat=data.source_lat,
        source_lng=data.source_lng,
        destination_apiary_id=data.destination_apiary_id,
        destination_location_name=data.destination_location_name,
        destination_lat=data.destination_lat,
        destination_lng=data.destination_lng,
        departure_date=data.departure_date,
        estimated_arrival_date=estimated_arrival,
        transport_vehicle=data.transport_vehicle,
        distance_km=round(distance_km, 2),
        beekeepers=beekeepers_json,
        hive_list=hive_list_json,
        status=RelocationStatus.PLANNED,
        notes=data.notes,
        created_by=current_user.id,
        created_by_username=current_user.username,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    logger.info(f"Relocation plan created by {current_user.username}: {plan.plan_name}")
    return _get_relocation_plan_response(plan)


@app.put("/api/relocation-plans/{plan_id}", response_model=RelocationPlanResponse)
async def update_relocation_plan(
    plan_id: int,
    data: RelocationPlanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """更新转场计划"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    if plan.status == RelocationStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="已完成的转场计划不可修改")

    update_dict = data.model_dump(exclude_unset=True)

    if "beekeepers" in update_dict:
        update_dict["beekeepers"] = json.dumps(update_dict["beekeepers"], ensure_ascii=False)
    if "hive_list" in update_dict:
        update_dict["hive_list"] = json.dumps(
            [h.model_dump() if hasattr(h, 'model_dump') else h for h in update_dict["hive_list"]],
            ensure_ascii=False
        )

    for key, value in update_dict.items():
        setattr(plan, key, value)

    if "source_lat" in update_dict or "source_lng" in update_dict or \
       "destination_lat" in update_dict or "destination_lng" in update_dict:
        plan.distance_km = round(haversine_distance(
            plan.source_lat, plan.source_lng,
            plan.destination_lat, plan.destination_lng
        ), 2)

    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    logger.info(f"Relocation plan updated by {current_user.username}: {plan.plan_name}")
    return _get_relocation_plan_response(plan)


@app.delete("/api/relocation-plans/{plan_id}")
async def delete_relocation_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["delete"])),
):
    """删除转场计划"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    if plan.status == RelocationStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="已完成的转场计划不可删除")

    db.query(RelocationLog).filter(RelocationLog.plan_id == plan_id).delete()
    db.delete(plan)
    db.commit()

    logger.info(f"Relocation plan deleted by {current_user.username}: {plan.plan_name}")
    return {"message": "转场计划已删除"}


@app.post("/api/relocation-plans/{plan_id}/start", response_model=RelocationPlanResponse)
async def start_relocation(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """开始转场（状态变为运输中）"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    if plan.status != RelocationStatus.PLANNED:
        raise HTTPException(status_code=400, detail="只有计划中的转场可以开始")

    plan.status = RelocationStatus.IN_TRANSIT
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    logger.info(f"Relocation started by {current_user.username}: {plan.plan_name}")
    return _get_relocation_plan_response(plan)


@app.post("/api/relocation-plans/{plan_id}/complete", response_model=RelocationPlanResponse)
async def complete_relocation(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """完成转场：批量更新蜂箱所属蜂场并写入迁场日志"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    if plan.status != RelocationStatus.IN_TRANSIT and plan.status != RelocationStatus.PLANNED:
        raise HTTPException(status_code=400, detail="只有计划中或运输中的转场可以完成")

    try:
        hive_list = json.loads(plan.hive_list) if plan.hive_list else []
    except Exception:
        hive_list = []

    if not hive_list:
        raise HTTPException(status_code=400, detail="转场计划没有装车蜂箱清单")

    updated_count = 0
    for hive_item in hive_list:
        hive_id = hive_item.get("hive_id")
        if not hive_id:
            continue

        beehive = db.query(Beehive).filter(Beehive.id == hive_id).first()
        if not beehive:
            continue

        old_apiary_id = beehive.apiary_id
        beehive.apiary_id = plan.destination_apiary_id
        beehive.location_lat = plan.destination_lat
        beehive.location_lng = plan.destination_lng
        beehive.last_inspected_at = datetime.utcnow()

        context_data = json.dumps({
            "plan_id": plan_id,
            "plan_name": plan.plan_name,
            "old_apiary_id": old_apiary_id,
            "new_apiary_id": plan.destination_apiary_id,
            "source_location": plan.source_location_name,
            "destination_location": plan.destination_location_name,
            "health_level": hive_item.get("health_level", "medium"),
            "queen_status": hive_item.get("queen_status", "normal"),
            "frame_count": hive_item.get("frame_count"),
            "load_order": hive_item.get("load_order"),
        }, ensure_ascii=False)

        op_log = BeehiveOperationLog(
            hive_id=beehive.id,
            hive_code=beehive.hive_code,
            operation_type=HiveOperationType.RELOCATE,
            operator_id=current_user.id,
            operator_username=current_user.username,
            context_data=context_data,
            description=f"转场: 从 {plan.source_location_name} 到 {plan.destination_location_name}",
            created_at=datetime.utcnow(),
        )
        db.add(op_log)

        relocation_log = RelocationLog(
            plan_id=plan_id,
            hive_id=beehive.id,
            hive_code=beehive.hive_code,
            source_apiary_id=plan.source_apiary_id,
            destination_apiary_id=plan.destination_apiary_id,
            operator_id=current_user.id,
            operator_username=current_user.username,
            context_data=context_data,
            description=f"转场完成: {plan.plan_name}",
            created_at=datetime.utcnow(),
        )
        db.add(relocation_log)

        updated_count += 1

    plan.status = RelocationStatus.COMPLETED
    plan.completed_at = datetime.utcnow()
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    logger.info(f"Relocation completed by {current_user.username}: {plan.plan_name}, updated {updated_count} hives")
    return _get_relocation_plan_response(plan)


@app.post("/api/relocation-plans/{plan_id}/cancel", response_model=RelocationPlanResponse)
async def cancel_relocation(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["update"])),
):
    """取消转场计划"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    if plan.status == RelocationStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="已完成的转场计划不可取消")

    plan.status = RelocationStatus.CANCELLED
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)

    logger.info(f"Relocation cancelled by {current_user.username}: {plan.plan_name}")
    return _get_relocation_plan_response(plan)


@app.get("/api/relocation-plans/{plan_id}/export-checklist")
async def export_relocation_checklist(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """导出现转场清单为CSV"""
    plan = db.query(RelocationPlan).filter(RelocationPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="转场计划不存在")

    try:
        hive_list = json.loads(plan.hive_list) if plan.hive_list else []
    except Exception:
        hive_list = []

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "装车顺序", "蜂箱编号", "健康度", "蜂王状态", "巢框数量", "是否检查", "备注"
    ])

    hive_list_sorted = sorted(hive_list, key=lambda x: x.get("load_order") or 999)
    for item in hive_list_sorted:
        writer.writerow([
            item.get("load_order", ""),
            item.get("hive_code", ""),
            item.get("health_level", ""),
            item.get("queen_status", ""),
            item.get("frame_count", ""),
            "是" if item.get("is_checked") else "否",
            item.get("notes", ""),
        ])

    output.seek(0)
    filename = f"转场清单_{plan.plan_name}_{datetime.now().strftime('%Y%m%d')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}"
        }
    )


# ============ 迁场日志接口 ============

@app.get("/api/relocation-logs", response_model=RelocationLogListResponse)
async def list_relocation_logs(
    page: int = 1,
    size: int = 20,
    plan_id: Optional[int] = None,
    hive_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions(["read"])),
):
    """获取迁场日志列表"""
    query = db.query(RelocationLog)

    if plan_id:
        query = query.filter(RelocationLog.plan_id == plan_id)
    if hive_id:
        query = query.filter(RelocationLog.hive_id == hive_id)

    total = query.count()
    query = query.order_by(RelocationLog.created_at.desc())
    offset = (page - 1) * size
    logs = query.offset(offset).limit(size).all()

    return {
        "items": [_get_relocation_log_response(log) for log in logs],
        "total": total,
        "page": page,
        "size": size,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
