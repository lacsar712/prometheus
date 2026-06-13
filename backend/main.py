import logging
import time
import random
import os
import asyncio
import json
from datetime import datetime, timedelta
from enum import Enum as PyEnum
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Enum, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel, EmailStr, Field, validator
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
