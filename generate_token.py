import secrets

from seatable_api import Base, context

TABLE_NAME = "Table1"
ID_COL     = "ID"
TOKEN_COL  = "Token"
TOKEN_LEN  = 16


def clean(value):
    return str(value or "").strip()


def new_token(used):
    while True:
        t = secrets.token_urlsafe(TOKEN_LEN)
        if t not in used:
            used.add(t)
            return t


def main():
    base = Base(context.api_token, context.server_url)
    base.auth()
    rows = base.list_rows(TABLE_NAME)
    target = next(
        (r for r in rows if clean(r.get(ID_COL)) and not clean(r.get(TOKEN_COL))), None
    )
    if target is None:
        return
    id = clean(target.get(ID_COL))
    token = secrets.token_urlsafe(TOKEN_LEN)
    base.update_row(TABLE_NAME, target["_id"], {TOKEN_COL: token})
    for row in rows:
        if row["_id"] != target["_id"] and clean(row.get(ID_COL)) == id:
            base.delete_row(TABLE_NAME, row["_id"])


if __name__ == "__main__":
    main()
