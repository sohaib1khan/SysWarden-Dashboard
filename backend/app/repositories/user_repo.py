from __future__ import annotations

import bcrypt

from app.models.user import User


class UserRepository:
    def count(self, db) -> int:
        return db.query(User).count()

    def get_by_id(self, db, user_id: int) -> User | None:
        return db.query(User).filter_by(id=user_id).first()

    def get_by_username(self, db, username: str) -> User | None:
        return db.query(User).filter_by(username=username).first()

    def list_all(self, db) -> list[User]:
        return db.query(User).order_by(User.id).all()

    def create(self, db, *, username: str, password: str, is_admin: bool = False) -> User:
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
        user = User(username=username, password_hash=hashed, is_admin=is_admin)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def update(
        self,
        db,
        user: User,
        *,
        username: str | None = None,
        password: str | None = None,
        is_admin: bool | None = None,
    ) -> User:
        if username is not None:
            user.username = username
        if password is not None:
            user.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
        if is_admin is not None:
            user.is_admin = is_admin
        db.commit()
        db.refresh(user)
        return user

    def delete(self, db, user_id: int) -> None:
        db.query(User).filter_by(id=user_id).delete()
        db.commit()

    def verify_password(self, plain: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(plain.encode(), hashed.encode())
        except Exception:
            return False


user_repo = UserRepository()
