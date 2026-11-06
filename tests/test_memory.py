from __future__ import annotations

import unittest
from unittest.mock import patch

from pipeline.h3_presets import (
    MemoryStatus,
    parse_vm_stat_output,
    recommend_safe_canvas,
)

SAMPLE_VM_STAT_OUTPUT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              12345.
Pages active:                           987654.
Pages inactive:                         456789.
Pages speculative:                       12340.
Pages throttled:                             0.
Pages wired down:                       432100.
Pages purgeable:                         25000.
"Translation faults":                123456789.
Pages copy-on-write:                   9876543.
Pages zero filled:                    45678901.
Pages reactivated:                       12345.
Pages purged:                             6789.
File-backed pages:                      234567.
Anonymous pages:                        765432.
Pages stored in compressor:             100000.
Pages occupied by compressor:            35000.
Decompressions:                          50000.
Compressions:                           120000.
Pageins:                                345678.
Pageouts:                                 1234.
Swapins:                                     0.
Swapouts:                                    0.
"""


class TestMemoryPerception(unittest.TestCase):
    def test_parse_vm_stat_output(self) -> None:
        page_size, avail_bytes = parse_vm_stat_output(SAMPLE_VM_STAT_OUTPUT)
        self.assertEqual(page_size, 16384)
        # free(12345) + inactive(456789) + speculative(12340) + purgeable(25000) = 506474 pages
        expected_pages = 12345 + 456789 + 12340 + 25000
        self.assertEqual(avail_bytes, expected_pages * 16384)
        avail_gib = avail_bytes / (1024**3)
        self.assertGreater(avail_gib, 7.0)

    @patch("pipeline.h3_presets.get_system_memory_status")
    def test_recommend_safe_canvas_auto_downgrade_when_low_memory(self, mock_mem: unittest.mock.MagicMock) -> None:
        mock_mem.return_value = MemoryStatus(
            total_gib=64.0,
            available_gib=32.0,  # < 48 GiB threshold
            is_macos=True,
            is_swap_risk=True,
            details="Mocked low RAM",
        )
        w, h, swap_warn = recommend_safe_canvas(960, 544, auto_downgrade=True)
        self.assertEqual((w, h), (864, 480))
        self.assertIsNotNone(swap_warn)
        assert swap_warn is not None
        self.assertIn("Automatically downgraded", swap_warn)

    @patch("pipeline.h3_presets.get_system_memory_status")
    def test_recommend_safe_canvas_preserves_when_memory_sufficient(self, mock_mem: unittest.mock.MagicMock) -> None:
        mock_mem.return_value = MemoryStatus(
            total_gib=128.0,
            available_gib=64.0,  # > 48 GiB threshold
            is_macos=True,
            is_swap_risk=False,
            details="Mocked high RAM",
        )
        w, h, swap_warn = recommend_safe_canvas(960, 544, auto_downgrade=True)
        self.assertEqual((w, h), (960, 544))
        self.assertIsNone(swap_warn)

    def test_recommend_safe_canvas_preserves_standard_canvas(self) -> None:
        w, h, swap_warn = recommend_safe_canvas(864, 480, auto_downgrade=True)
        self.assertEqual((w, h), (864, 480))
        self.assertIsNone(swap_warn)


if __name__ == "__main__":
    unittest.main()
