"""Notification preferences and Devices (TDD 20). No financial fields."""

from typing import Annotated

from pydantic import BaseModel, Field

from accanto.dtos.monthly import Input

Hour = Annotated[int, Field(ge=0, le=23)]


class Preferences(Input):
    hour: Hour
    routines_due: bool
    scheduled_entries: bool
    transactions_waiting: bool
    # Absent from callers written before Spending alerts (TDD 23): on.
    spending_alerts: bool = True


class SubscriptionKeys(BaseModel):
    p256dh: Annotated[str, Field(min_length=1, max_length=120)]
    auth: Annotated[str, Field(min_length=1, max_length=60)]


class DeviceInput(BaseModel):
    """The browser's PushSubscription.toJSON(); expirationTime is ignored."""

    endpoint: Annotated[str, Field(min_length=1, max_length=2000)]
    keys: SubscriptionKeys
