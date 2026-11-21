"""Request/response models for outfit planning.

Field names follow docs/integrations/ai-app-api.md (the A/B agreement on main).
Fields marked "extension" are additive and optional for B to use.
"""

from datetime import date as Date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Category = Literal["top", "bottom", "dress", "outerwear", "shoes", "accessory"]


# ---------- shared objects (contract) ----------

class StyleDirection(BaseModel):
    """One style the user likes (extension, proposed in docs/ai/proposals/style-profile-directions.md)."""
    id: str
    name: str
    strength: Literal["dominant", "secondary", "minor"]
    description: str = ""
    colors: list[str] = []
    silhouettes: list[str] = []
    stylingPatterns: list[str] = []
    keyPieces: list[str] = []
    visualReferenceIds: list[str] = []
    source: Literal["media", "tags", "both"] = "media"


class StyleProfile(BaseModel):
    styleTags: list[str] = []
    colors: list[str] = []
    avoidances: list[str] = []
    visualReferenceIds: list[str] = []
    notes: Optional[str] = None
    aesthetics: list[str] = []
    silhouettes: list[str] = []
    stylingPatterns: list[str] = []
    directions: list[StyleDirection] = []  # extension: strongest first


class Destination(BaseModel):
    id: str
    name: str
    countryCode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: Optional[str] = None


class Attraction(BaseModel):
    id: str
    name: str
    source: Literal["curated", "provider", "user"] = "user"
    activityTags: list[str] = []
    date: Optional[Date] = None
    notes: Optional[str] = None


class WeatherDay(BaseModel):
    """One day of weather, fetched by B for the trip's destination and dates."""
    date: Date
    # "climate" (extension): typical seasonal values for dates beyond forecast coverage
    kind: Literal["forecast", "climate", "unavailable"] = "unavailable"
    minTempC: Optional[float] = None
    maxTempC: Optional[float] = None
    precipitationProbabilityPct: Optional[float] = None
    sourceUrl: Optional[str] = None
    fetchedAt: Optional[str] = None
    # extensions: optional detail when B's provider has it
    conditions: Optional[str] = Field(None, description="extension: short summary, e.g. 'light rain'")
    windKph: Optional[float] = None
    humidityPct: Optional[float] = None


class MediaRef(BaseModel):
    """An inspiration image/video B stores; A downloads it from readUrl."""
    id: str
    contentVersion: str = "1"
    kind: Literal["image", "video"]
    mimeType: str
    readUrl: str
    expiresAt: Optional[datetime] = None


class Trip(BaseModel):
    destination: Destination
    startDate: Date
    endDate: Date
    attractions: list[Attraction] = []
    weather: list[WeatherDay] = []
    notes: Optional[str] = None


class WardrobeItem(BaseModel):
    id: str
    name: str
    imageUrl: Optional[str] = None
    category: Category
    color: Optional[str] = None
    styleTags: list[str] = []


class MissingItem(BaseModel):
    id: str
    description: str
    searchQuery: str
    priority: Literal["essential", "optional"]
    reason: str
    # extension: structured descriptors for the shopping integration
    category: Optional[Category] = None
    color: Optional[str] = None
    silhouette: Optional[str] = None
    material: Optional[str] = None
    styleDescriptors: list[str] = []


class OutfitPiece(BaseModel):
    id: str  # wardrobe id when owned, missing-item id when not
    name: str
    owned: bool


class Outfit(BaseModel):
    id: str
    date: Date
    attractionIds: list[str]
    wardrobeItemIds: list[str]
    rationale: str
    missingItems: list[MissingItem]
    stylingTips: list[str] = []
    # extensions
    name: Optional[str] = None
    itemsByCategory: dict[str, list[OutfitPiece]] = {}
    occasions: list[str] = []
    styleConnections: list[str] = []
    inspirationReferenceIds: list[str] = []  # inspiration media ids that shaped this outfit
    directionId: Optional[str] = None  # style direction that leads this outfit (extension)
    weatherKind: Literal["forecast", "climate", "unavailable"] = "unavailable"  # weather it was planned for


# ---------- endpoint bodies ----------

class OutfitPlanRequest(BaseModel):
    requestId: str
    inputRevision: int
    styleProfile: StyleProfile
    trip: Trip
    wardrobeVersion: str = "unversioned"
    wardrobe: list[WardrobeItem] = []
    media: list[MediaRef] = []
    preferences: Optional[str] = Field(None, description="extension: free-text user preferences")
    outfitCount: int = Field(3, ge=1, le=14, description="extension: total outfits to return")
    useWardrobeImages: bool = Field(True, description="extension: send wardrobe photos to Gemini")
    useInspirationMedia: bool = Field(True, description="extension: send inspiration media to Gemini")


class InspirationNote(BaseModel):
    """What the planner took from one inspiration item (extension)."""
    mediaId: str
    takeaway: str
    usable: bool
    usedInOutfitIds: list[str] = []


class OutfitPlanResponse(BaseModel):
    requestId: str
    inputRevision: int
    outfits: list[Outfit]
    warnings: list[str]
    shoppingGaps: list["ShoppingGap"] = []  # extension
    model: Optional[str] = None  # extension
    wardrobeImagesUsed: list[str] = []  # extension: wardrobe ids whose photo Gemini saw
    inspirationMediaUsed: list[str] = []  # extension: inspiration media ids Gemini saw
    inspirationNotes: list[InspirationNote] = []  # extension: per inspiration item, what was borrowed and where


class ShoppingGap(BaseModel):
    """One deduplicated thing to shop for, possibly needed by several outfits."""
    id: str
    searchQuery: str
    category: Optional[Category] = None
    color: Optional[str] = None
    silhouette: Optional[str] = None
    material: Optional[str] = None
    styleDescriptors: list[str] = []
    priority: Literal["essential", "optional"]
    reason: str
    outfitIds: list[str]
    missingItemIds: list[str]
    similarOwnedItemIds: list[str] = Field(
        [], description="Owned items with the same category and color; check before buying")


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    requestId: Optional[str] = None
    inputRevision: Optional[int] = None
    error: ErrorBody


OutfitPlanResponse.model_rebuild()
