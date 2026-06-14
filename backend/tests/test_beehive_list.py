from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
import pytest

from .conftest import create_test_beehives
from main import StrengthLevel


class Test蜂箱档案列表_空列表场景:
    def test_蜂箱列表为空时返回空数组和零总数(
        self,
        test_client: TestClient,
        farm_owner_token: str,
    ):
        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []
        assert data["page"] == 1
        assert data["size"] == 20


class Test蜂箱档案列表_单页场景:
    def test_列表恰好一页时返回全部数据(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=10, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 1, "size": 20},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 10
        assert len(data["items"]) == 10
        assert data["page"] == 1
        assert data["size"] == 20

    def test_自定义每页条数时正确返回对应数量(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=15, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 1, "size": 5},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 15
        assert len(data["items"]) == 5
        assert data["page"] == 1
        assert data["size"] == 5


class Test蜂箱档案列表_多页翻页场景:
    def test_第一页返回前size条数据(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=25, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 1, "size": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 25
        assert len(data["items"]) == 10
        assert data["page"] == 1

    def test_第二页返回中间size条数据(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=25, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 2, "size": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 25
        assert len(data["items"]) == 10
        assert data["page"] == 2

    def test_第三页返回剩余不足size条数据(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=25, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 3, "size": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 25
        assert len(data["items"]) == 5
        assert data["page"] == 3

    def test_页码超出总页数时返回空数组(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=15, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"page": 100, "size": 10},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 15
        assert data["items"] == []
        assert data["page"] == 100
        assert data["size"] == 10


class Test蜂箱档案列表_所属蜂场过滤:
    def test_蜂场过滤命中时返回该蜂场的蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001", start_code=1)
        create_test_beehives(db_session, count=3, apiary_id="farm_002", start_code=100)

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"apiary_id": "farm_001"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        for item in data["items"]:
            assert item["apiary_id"] == "farm_001"

    def test_蜂场过滤不命中时返回空列表(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"apiary_id": "nonexistent_farm"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0
        assert data["items"] == []


class Test蜂箱档案列表_群势多选过滤:
    def test_单选弱群势时只返回弱群蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=3, apiary_id="farm_001", start_code=1,
            strength_level=StrengthLevel.WEAK,
        )
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=10,
            strength_level=StrengthLevel.STRONG,
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"strength_in": "weak"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        for item in data["items"]:
            assert item["strength_level"] == "weak"

    def test_多选弱和中群势时返回两种群势的蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=1,
            strength_level=StrengthLevel.WEAK,
        )
        create_test_beehives(
            db_session, count=3, apiary_id="farm_001", start_code=10,
            strength_level=StrengthLevel.MEDIUM,
        )
        create_test_beehives(
            db_session, count=4, apiary_id="farm_001", start_code=20,
            strength_level=StrengthLevel.STRONG,
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"strength_in": "weak,medium"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        for item in data["items"]:
            assert item["strength_level"] in ("weak", "medium")

    def test_多选全部群势时返回所有蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=1,
            strength_level=StrengthLevel.WEAK,
        )
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=10,
            strength_level=StrengthLevel.MEDIUM,
        )
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=20,
            strength_level=StrengthLevel.STRONG,
        )
        create_test_beehives(
            db_session, count=2, apiary_id="farm_001", start_code=30,
            strength_level=StrengthLevel.VERY_STRONG,
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"strength_in": "weak,medium,strong,very_strong"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 8

    def test_群势过滤值不合法时返回空列表(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"strength_in": "invalid_level"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0


class Test蜂箱档案列表_关键字模糊匹配:
    def test_关键字匹配蜂箱编号时返回对应蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=10, apiary_id="farm_001", start_code=1)

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"keyword": "BEE-0005"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["hive_code"] == "BEE-0005"

    def test_关键字部分匹配蜂箱编号时返回所有匹配项(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=20, apiary_id="farm_001", start_code=1)

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"keyword": "001"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        for item in data["items"]:
            assert "001" in item["hive_code"]

    def test_关键字匹配备注内容时返回对应蜂箱(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=5, apiary_id="farm_001", start_code=1,
            notes_prefix="特殊标记",
        )
        create_test_beehives(
            db_session, count=5, apiary_id="farm_001", start_code=10,
            notes_prefix="普通",
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"keyword": "特殊标记"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        for item in data["items"]:
            assert "特殊标记" in item["notes"]

    def test_关键字不匹配任何内容时返回空列表(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"keyword": "不存在的关键词"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 0


class Test蜂箱档案列表_权限控制:
    def test_未登录请求被拒绝(
        self,
        test_client: TestClient,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get("/api/hives")
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_无效token请求被拒绝(
        self,
        test_client: TestClient,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": "Bearer invalid_token_12345"},
        )
        assert response.status_code == 401
        assert "detail" in response.json()

    def test_场主账号请求被允许(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=3, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3

    def test_养蜂员账号请求被允许(
        self,
        test_client: TestClient,
        beekeeper_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=3, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {beekeeper_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3

    def test_技术员只读账号请求被允许(
        self,
        test_client: TestClient,
        technician_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=3, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {technician_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3

    def test_审计员只读账号请求被允许(
        self,
        test_client: TestClient,
        auditor_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=3, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {auditor_token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3

    def test_无任何权限的外部账号请求被拒绝(
        self,
        test_client: TestClient,
        auditor_user,
        auditor_token: str,
        db_session: Session,
        monkeypatch,
    ):
        import main
        create_test_beehives(db_session, count=3, apiary_id="farm_001")

        original_permissions = main.ROLE_PERMISSIONS.copy()
        modified_permissions = original_permissions.copy()
        modified_permissions[auditor_user.role] = []
        monkeypatch.setattr(main, "ROLE_PERMISSIONS", modified_permissions)

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {auditor_token}"},
        )
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert "权限" in data["detail"] or "permission" in data["detail"].lower()


class Test蜂箱档案列表_排序功能:
    def test_按创建时间倒序排列(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"order_by": "created_at", "order_dir": "desc"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 5
        ids = [item["id"] for item in data["items"]]
        assert ids == sorted(ids, reverse=True)

    def test_按创建时间正序排列(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"order_by": "created_at", "order_dir": "asc"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 5
        ids = [item["id"] for item in data["items"]]
        assert ids == sorted(ids)

    def test_按蜂箱编号排序(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"order_by": "hive_code", "order_dir": "asc"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 5
        codes = [item["hive_code"] for item in data["items"]]
        assert codes == sorted(codes)

    def test_排序字段传非法值时返回明确错误(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(db_session, count=5, apiary_id="farm_001")

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={"order_by": "invalid_field"},
        )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "order_by" in data["detail"].lower() or "排序" in data["detail"] or "非法" in data["detail"]


class Test蜂箱档案列表_组合查询:
    def test_关键字加蜂场过滤组合查询(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=5, apiary_id="farm_001", start_code=1,
            notes_prefix="农场1-",
        )
        create_test_beehives(
            db_session, count=5, apiary_id="farm_002", start_code=100,
            notes_prefix="农场2-",
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={
                "keyword": "农场1",
                "apiary_id": "farm_001",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        for item in data["items"]:
            assert item["apiary_id"] == "farm_001"
            assert "农场1" in item["notes"]

    def test_群势加蜂场加分页组合查询(
        self,
        test_client: TestClient,
        farm_owner_token: str,
        db_session: Session,
    ):
        create_test_beehives(
            db_session, count=10, apiary_id="farm_001", start_code=1,
            strength_level=StrengthLevel.STRONG,
        )
        create_test_beehives(
            db_session, count=5, apiary_id="farm_002", start_code=100,
            strength_level=StrengthLevel.STRONG,
        )
        create_test_beehives(
            db_session, count=8, apiary_id="farm_001", start_code=200,
            strength_level=StrengthLevel.WEAK,
        )

        response = test_client.get(
            "/api/hives",
            headers={"Authorization": f"Bearer {farm_owner_token}"},
            params={
                "apiary_id": "farm_001",
                "strength_in": "strong",
                "page": 1,
                "size": 5,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 10
        assert len(data["items"]) == 5
        for item in data["items"]:
            assert item["apiary_id"] == "farm_001"
            assert item["strength_level"] == "strong"
