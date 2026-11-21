"""HTTP API for the AI service (paths from docs/integrations/ai-app-api.md).

Run from services/ai/ with the venv active:
    uvicorn src.api.app:app --port 8001 --reload
Interactive docs: http://localhost:8001/docs
"""

import json
import os
from typing import Optional

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..outfit_planning.models import (ErrorBody, ErrorResponse, Outfit, OutfitPlanRequest,
                                      OutfitPlanResponse, ShoppingGap, WardrobeItem)
from ..outfit_planning.planner import PlanningError, generate_outfits
from ..outfit_planning.shopping import identify_shopping_gaps
from ..preview_generation.visualize import GENERATED_DIR, PreviewRequest, PreviewResponse, visualize_outfit
from ..style_analysis.service import (StyleAnalysisError, StyleAnalysisRequest,
                                      StyleAnalysisResponse, analyze_style)

app = FastAPI(title="Travel AI Stylist - AI service", version="0.1.0")
GENERATED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media/generated", StaticFiles(directory=GENERATED_DIR), name="generated")
SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN")  # unset = no auth (local dev)


def error(status: int, code: str, message: str, retryable: bool, body: dict | None = None) -> JSONResponse:
    body = body or {}
    rev = body.get("inputRevision")
    return JSONResponse(status_code=status, content=ErrorResponse(
        requestId=body.get("requestId") if isinstance(body.get("requestId"), str) else None,
        inputRevision=rev if isinstance(rev, int) else None,
        error=ErrorBody(code=code, message=message, retryable=retryable),
    ).model_dump())


def authorized(authorization: Optional[str]) -> bool:
    return not SERVICE_TOKEN or authorization == f"Bearer {SERVICE_TOKEN}"


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    try:
        body = json.loads(await request.body())
    except Exception:
        body = {}
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return error(400, "INVALID_REQUEST", f"{where}: {first.get('msg', 'invalid request')}", False,
                 body if isinstance(body, dict) else {})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/style-analysis", response_model=StyleAnalysisResponse)
def style_analysis(req: StyleAnalysisRequest, authorization: Optional[str] = Header(None)):
    body = {"requestId": req.requestId, "inputRevision": req.inputRevision}
    if not authorized(authorization):
        return error(401, "UNAUTHORIZED", "Missing or invalid service token.", False, body)
    try:
        return analyze_style(req)
    except StyleAnalysisError as e:
        return error(e.status, e.code, e.message, e.retryable, body)


@app.post("/v1/outfit-plans", response_model=OutfitPlanResponse)
def outfit_plans(req: OutfitPlanRequest, authorization: Optional[str] = Header(None)):
    body = {"requestId": req.requestId, "inputRevision": req.inputRevision}
    if not authorized(authorization):
        return error(401, "UNAUTHORIZED", "Missing or invalid service token.", False, body)
    try:
        return generate_outfits(req)
    except PlanningError as e:
        return error(e.status, e.code, e.message, e.retryable, body)


class ShoppingGapsRequest(BaseModel):
    outfits: list[Outfit]
    wardrobe: list[WardrobeItem] = []


@app.post("/v1/shopping-gaps", response_model=list[ShoppingGap])
def shopping_gaps(req: ShoppingGapsRequest, authorization: Optional[str] = Header(None)):
    if not authorized(authorization):
        return error(401, "UNAUTHORIZED", "Missing or invalid service token.", False)
    return identify_shopping_gaps(req.outfits, req.wardrobe)


@app.post("/v1/outfit-previews", response_model=PreviewResponse)
def outfit_previews(req: PreviewRequest, authorization: Optional[str] = Header(None)):
    if not authorized(authorization):
        return error(401, "UNAUTHORIZED", "Missing or invalid service token.", False)
    return visualize_outfit(req)
