from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from jose import JWTError, jwt
from passlib.context import CryptContext
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from app.config import get_settings
from app.database import users_container
import uuid

router = APIRouter()
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    display_name: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str


def create_token(data: dict) -> str:
    settings = get_settings()
    expire = datetime.utcnow() + timedelta(hours=settings.jwt_expire_hours)
    to_encode = {**data, "exp": expire}
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        # Fetch user from Cosmos DB
        container = users_container()
        try:
            user = container.read_item(item=user_id, partition_key=user_id)
            return user
        except CosmosResourceNotFoundError:
            raise HTTPException(status_code=401, detail="User not found")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _find_user_by_email(email: str):
    """Find user by email using a query."""
    container = users_container()
    query = "SELECT * FROM c WHERE c.email = @email"
    params = [{"name": "@email", "value": email}]
    results = list(container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
    return results[0] if results else None


@router.post("/register", response_model=Token)
async def register(user: UserRegister):
    # Check if email already exists
    existing = _find_user_by_email(user.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = str(uuid.uuid4())
    user_data = {
        "id": user_id,
        "email": user.email,
        "passwordHash": pwd_context.hash(user.password),
        "displayName": user.display_name,
        "role": "learner",
        "createdAt": datetime.utcnow().isoformat(),
        "lastLoginAt": datetime.utcnow().isoformat(),
    }

    container = users_container()
    container.create_item(body=user_data)

    token = create_token({"sub": user_id})
    return Token(access_token=token)


@router.post("/login", response_model=Token)
async def login(user: UserLogin):
    db_user = _find_user_by_email(user.email)
    if not db_user or not pwd_context.verify(user.password, db_user["passwordHash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Update last login
    container = users_container()
    db_user["lastLoginAt"] = datetime.utcnow().isoformat()
    container.upsert_item(body=db_user)

    token = create_token({"sub": db_user["id"]})
    return Token(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        display_name=current_user["displayName"],
        role=current_user["role"],
    )
