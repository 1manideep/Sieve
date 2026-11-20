"""Errors the callables map to HttpsError codes (30 section 7.1). Messages are one plain sentence."""
from __future__ import annotations


class InputError(ValueError):
    """-> INVALID_ARGUMENT"""


class NotFound(LookupError):
    """-> NOT_FOUND"""


class Precondition(RuntimeError):
    """-> FAILED_PRECONDITION"""


class LimitReached(RuntimeError):
    """-> RESOURCE_EXHAUSTED"""
