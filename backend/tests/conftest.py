import sys
import os
from datetime import datetime, timedelta
from typing import Generator, List

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from fastapi.testclient import TestClient
import jwt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main
from main import (
    Base,
    User,
    Beehive,
    UserRole,
    StrengthLevel,
    SECRET_KEY,
    ALGORITHM,
    pwd_context,
)

TEST_DATABASE_URL = "sqlite:///./test.db"


def _mock_noop(*args, **kwargs):
    pass


main.init_db = _mock_noop
main.init_storage = _mock_noop
main.init_scheduler = _mock_noop
main.init_config_center = _mock_noop
main.init_minio_bucket = _mock_noop
main.init_preset_configs = _mock_noop
main.load_configs_to_cache = _mock_noop


@pytest.fixture(scope="function")
def db_engine():
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists("./test.db"):
        os.remove("./test.db")


@pytest.fixture(scope="function")
def db_session(db_engine) -> Generator[Session, None, None]:
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=db_engine
    )
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="function")
def test_client(db_session: Session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    main.app.dependency_overrides[main.get_db] = override_get_db
    with TestClient(main.app) as client:
        yield client
    main.app.dependency_overrides.clear()


def create_test_user(
    db: Session,
    username: str,
    role: UserRole,
    password: str = "test123456",
) -> User:
    hashed = pwd_context.hash(password)
    user = User(
        username=username,
        hashed_password=hashed,
        role=role,
        farm_scope="[]",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_test_token(user_id: int, username: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=30)
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture(scope="function")
def farm_owner_user(db_session: Session) -> User:
    return create_test_user(db_session, "farm_owner", UserRole.FARM_OWNER)


@pytest.fixture(scope="function")
def farm_owner_token(farm_owner_user: User) -> str:
    return create_test_token(
        farm_owner_user.id,
        farm_owner_user.username,
        farm_owner_user.role.value,
    )


@pytest.fixture(scope="function")
def beekeeper_user(db_session: Session) -> User:
    return create_test_user(db_session, "beekeeper", UserRole.BEEKEEPER)


@pytest.fixture(scope="function")
def beekeeper_token(beekeeper_user: User) -> str:
    return create_test_token(
        beekeeper_user.id,
        beekeeper_user.username,
        beekeeper_user.role.value,
    )


@pytest.fixture(scope="function")
def technician_user(db_session: Session) -> User:
    return create_test_user(db_session, "technician", UserRole.TECHNICIAN)


@pytest.fixture(scope="function")
def technician_token(technician_user: User) -> str:
    return create_test_token(
        technician_user.id,
        technician_user.username,
        technician_user.role.value,
    )


@pytest.fixture(scope="function")
def auditor_user(db_session: Session) -> User:
    return create_test_user(db_session, "auditor", UserRole.AUDITOR)


@pytest.fixture(scope="function")
def auditor_token(auditor_user: User) -> str:
    return create_test_token(
        auditor_user.id,
        auditor_user.username,
        auditor_user.role.value,
    )


def create_test_beehives(
    db: Session,
    count: int,
    apiary_id: str = "farm_001",
    start_code: int = 1,
    strength_level: StrengthLevel = StrengthLevel.MEDIUM,
    notes_prefix: str = "",
) -> List[Beehive]:
    hives = []
    for i in range(count):
        code_num = start_code + i
        hive = Beehive(
            hive_code=f"BEE-{code_num:04d}",
            apiary_id=apiary_id,
            bee_species="意蜂",
            box_type="标准箱",
            strength_level=strength_level,
            temperature=35.0 + i * 0.1,
            humidity=60.0 + i * 0.5,
            weight=30.0 + i * 0.5,
            status="active",
            notes=f"{notes_prefix}备注信息{code_num}",
        )
        db.add(hive)
        hives.append(hive)
    db.commit()
    for hive in hives:
        db.refresh(hive)
    return hives
