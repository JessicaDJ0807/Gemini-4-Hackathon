"""Output schemas for style extraction.

`StyleExtraction` is what we ask Gemini to return. It is richer than the shared
`StyleProfile` contract (packages/contracts/README.md): every trait cites the
images that support it, so we can check evidence and catch hallucinated ids.
`to_style_profile()` flattens it into the contract shape the app consumes.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ImageObservation(BaseModel):
    image_id: str
    garments: list[str] = Field(description="Visible garments and accessories on the main subject")
    aesthetics: list[str]
    colors: list[str]
    silhouettes: list[str]
    styling_details: list[str] = Field(description="Layering, proportions, accessories, prints, etc.")
    notes: str = Field(description="Uncertainty, cropping, or anything hard to read")


class Trait(BaseModel):
    label: str
    image_ids: list[str]


class StyleDirection(BaseModel):
    name: str
    description: str
    image_ids: list[str]
    strength: Literal["dominant", "secondary", "minor"]


class StyleExtraction(BaseModel):
    per_image: list[ImageObservation]
    style_directions: list[StyleDirection]
    aesthetics: list[Trait]
    colors: list[Trait]
    silhouettes: list[Trait]
    styling_patterns: list[Trait]
    avoidances: list[Trait]
    summary: str = Field(description="Two or three sentences a user can read and edit")


def to_style_profile(extraction: StyleExtraction, image_ids: list[str]) -> dict:
    """Map to the shared StyleProfile contract."""
    labels = lambda traits: [t.label for t in traits]
    return {
        "aesthetics": labels(extraction.aesthetics),
        "colors": labels(extraction.colors),
        "silhouettes": labels(extraction.silhouettes),
        "stylingPatterns": labels(extraction.styling_patterns),
        "avoidances": labels(extraction.avoidances),
        "visualReferenceIds": image_ids,
    }


def invalid_image_ids(extraction: StyleExtraction, valid: set[str]) -> list[str]:
    """Return every cited image id that was not in the input."""
    cited: list[str] = [o.image_id for o in extraction.per_image]
    for d in extraction.style_directions:
        cited += d.image_ids
    for group in (extraction.aesthetics, extraction.colors, extraction.silhouettes,
                  extraction.styling_patterns, extraction.avoidances):
        for t in group:
            cited += t.image_ids
    return sorted({i for i in cited if i not in valid})
