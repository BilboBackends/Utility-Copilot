from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma

# Step 1: Load Documents
file_path = ''  # Replace with your PDF file path
loader = PyPDFLoader(file_path)
documents = loader.load()

# Step 2: Split Documents into Chunks
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,  # Max token count per chunk
    chunk_overlap=200,  # Token overlap between chunks
)
docs = text_splitter.split_documents(documents)

# Step 3: Generate Embeddings
embeddings = OpenAIEmbeddings()  # Uses OpenAI's embedding model

# Step 4: Store in Vector Database (Chroma)
persist_directory = "./chroma_db"  # Directory to persist Chroma database
vectordb = Chroma.from_documents(docs, embedding=embeddings, persist_directory=persist_directory)

print(f"Number of documents stored: {vectordb._collection.count()}")
