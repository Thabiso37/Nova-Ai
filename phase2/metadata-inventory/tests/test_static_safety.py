import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / "inventory.py").read_text()
FIXTURE = (ROOT / "fixtures" / "bootstrap.sql").read_text()

class StaticSafetyTests(unittest.TestCase):
    def test_requires_explicit_dsn(self):
        self.assertIn("INVENTORY_DSN", SCRIPT)
    def test_repeatable_read_read_only(self):
        self.assertIn("REPEATABLE READ", SCRIPT)
        self.assertIn("readonly=True", SCRIPT)
    def test_never_queries_application_rows(self):
        self.assertNotIn("SELECT * FROM novaai_app.customers", SCRIPT)
        self.assertNotIn("SELECT * FROM novaai_app.sellers", SCRIPT)
    def test_canaries_are_synthetic(self):
        self.assertIn("CANARY_CUSTOMER_7f3c2a91", FIXTURE)
        self.assertIn("CANARY_SELLER_8b1d4e62", FIXTURE)
    def test_no_ddl_output(self):
        self.assertNotIn("CREATE TABLE", SCRIPT)
        self.assertNotIn("ALTER TABLE", SCRIPT)
    def test_explicit_classification(self):
        self.assertIn('"novaai_app": "A_NOVAAI_OWNED"', SCRIPT)

if __name__ == "__main__":
    unittest.main()
