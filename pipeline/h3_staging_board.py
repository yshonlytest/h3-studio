from __future__ import annotations

"""2D Top-Down Staging Board Coordinate to H3 Camera Direction Compiler."""

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Point2D:
    x: float
    y: float


@dataclass(frozen=True)
class CameraTrack:
    start: Point2D
    end: Point2D
    subject: Point2D
    fov_deg: float = 50.0


def compile_camera_direction(track: CameraTrack) -> str:
    dx_cam = track.end.x - track.start.x
    dy_cam = track.end.y - track.start.y
    dist_start = math.hypot(track.start.x - track.subject.x, track.start.y - track.subject.y)
    dist_end = math.hypot(track.end.x - track.subject.x, track.end.y - track.subject.y)
    d_dist = dist_end - dist_start

    descriptors: list[str] = []
    if d_dist < -0.08:
        descriptors.append("smooth dolly-in movement towards the subject")
    elif d_dist > 0.08:
        descriptors.append("smooth pull-back movement away from the subject")

    if dx_cam > 0.1:
        descriptors.append("rightward tracking motion")
    elif dx_cam < -0.1:
        descriptors.append("leftward tracking motion")

    angle_start = math.atan2(track.start.y - track.subject.y, track.start.x - track.subject.x)
    angle_end = math.atan2(track.end.y - track.subject.y, track.end.x - track.subject.x)
    d_angle = angle_end - angle_start
    if abs(d_angle) > 0.25:
        orbit_dir = "clockwise" if d_angle > 0 else "counter-clockwise"
        descriptors.append(f"{orbit_dir} arcing orbital camera move")

    if not descriptors:
        return "static camera keeping the subject tightly framed"
    return f"cinematic {', and '.join(descriptors)}, maintaining the subject in sharp focus"
