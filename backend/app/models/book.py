from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, Float, JSON
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func
import uuid


class BookBase(DeclarativeBase):
    pass


class Book(BookBase):
    __tablename__ = "books"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    author = Column(String, nullable=True)
    isbn = Column(String, nullable=True)
    cover_url = Column(String, nullable=True)
    cover_local = Column(String, nullable=True)
    synopsis = Column(Text, nullable=True)
    author_bio = Column(Text, nullable=True)
    author_bibliography = Column(JSON, nullable=True)  # list of other books
    genre = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    pages = Column(Integer, nullable=True)
    language = Column(String, nullable=True)

    # File info
    file_path = Column(String, nullable=True)
    file_type = Column(String, nullable=True)  # pdf | epub
    file_size = Column(Integer, nullable=True)

    # Processing state
    status = Column(String, default="uploaded")
    # uploaded → identifying → identified → structuring → structured → analyzing → complete
    phase1_done = Column(Boolean, default=False)
    phase2_done = Column(Boolean, default=False)
    phase3_done = Column(Boolean, default=False)
    phase4_done = Column(Boolean, default=False)
    phase5_done = Column(Boolean, default=False)
    phase6_done = Column(Boolean, default=False)
    task_id = Column(String, nullable=True)
    error_msg = Column(Text, nullable=True)

    # Results
    global_summary = Column(Text, nullable=True)
    mindmap_data = Column(JSON, nullable=True)
    podcast_audio_path = Column(String, nullable=True)
    podcast_script = Column(Text, nullable=True)
    podcast_duration = Column(Integer, nullable=True)  # duration in seconds

    # Reading tracking
    read_status = Column(String, default="to_read")  # to_read | reading | read
    rating = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class BookPart(BookBase):
    __tablename__ = "book_parts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    order = Column(Integer, nullable=False)


class Chapter(BookBase):
    __tablename__ = "chapters"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id = Column(String, nullable=False, index=True)
    part_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    order = Column(Integer, nullable=False)
    page_start = Column(Integer, nullable=True)
    page_end = Column(Integer, nullable=True)
    raw_text = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    key_events = Column(JSON, nullable=True)  # list of strings
    summary_status = Column(String, default="pending")  # pending | processing | done


class Character(BookBase):
    __tablename__ = "characters"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    aliases = Column(JSON, nullable=True)
    role = Column(String, nullable=True)  # protagonist | antagonist | secondary | minor
    description = Column(Text, nullable=True)
    personality = Column(Text, nullable=True)
    arc = Column(Text, nullable=True)  # character development arc
    relationships = Column(JSON, nullable=True)  # {char_name: relationship_type}
    first_appearance = Column(String, nullable=True)  # chapter title
    appearances = Column(JSON, nullable=True)  # list of chapter ids
    quotes = Column(JSON, nullable=True)  # notable quotes
    key_moments = Column(JSON, nullable=True)  # crucial moments in the story


class AnalysisJob(BookBase):
    __tablename__ = "analysis_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id = Column(String, nullable=False, index=True)
    task_id = Column(String, nullable=True)
    phase = Column(Integer, nullable=False)
    status = Column(String, default="queued")  # queued | running | done | error
    progress = Column(Integer, default=0)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class ChatMessage(BookBase):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    mode = Column(String, default="default")  # default | author | critic | child
    model = Column(String, nullable=True)     # gemini-1.5-flash | gpt-4o | etc
    created_at = Column(DateTime, server_default=func.now())
