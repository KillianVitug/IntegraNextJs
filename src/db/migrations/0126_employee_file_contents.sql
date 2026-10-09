CREATE TABLE employee_file_contents (
 file_id uuid PRIMARY KEY REFERENCES employee_files(id) ON DELETE CASCADE,
 content_base64 text NOT NULL,
 sha256 varchar(64) NOT NULL,
 size integer NOT NULL CHECK (size > 0 AND size <= 3145728),
 mime_type varchar(100) NOT NULL,
 created_at timestamp NOT NULL DEFAULT now(),
 CONSTRAINT employee_file_contents_base64_size CHECK (length(content_base64) = 4 * ((size + 2) / 3)),
 CONSTRAINT employee_file_contents_hash_format CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
