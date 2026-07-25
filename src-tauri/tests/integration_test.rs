use std::sync::Mutex;
use knowledge_master_lib::store::KnowledgeStore;
use knowledge_master_lib::models::*;

fn test_store() -> KnowledgeStore {
    let tmp = std::env::temp_dir().join(format!("km-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    KnowledgeStore::new(Some(tmp)).unwrap()
}

#[test]
fn test_import_and_search() {
    let mut store = test_store();
    let input = store.root_path.join("test.txt");
    std::fs::write(&input, "RAG 检索增强生成").unwrap();

    let msgs = store.import_files(&[input]).unwrap();
    assert!(msgs.iter().any(|m| m.contains("已导入")), "Import should succeed");
    assert_eq!(store.data.documents.len(), 1);

    let results = store.search("RAG", None);
    assert_eq!(results.len(), 1, "Search should find document");

    // Duplicate import should be rejected
    let msgs2 = store.import_files(&[store.stored_path_for(&store.data.documents[0])]).unwrap();
    assert!(msgs2.iter().any(|m| m.contains("同名丢弃") || m.contains("内容重复")),
            "Duplicate should be rejected: {:?}", msgs2);
}

#[test]
fn test_topic_crud() {
    let mut store = test_store();

    // Create
    let topic = store.create_topic("AI", None).unwrap().unwrap();
    assert_eq!(topic.name, "AI");

    // Rename
    store.rename_topic(topic.id, "人工智能").unwrap();
    assert_eq!(store.data.topics[0].name, "人工智能");

    // Create child
    let child = store.create_topic("LLM", Some(topic.id)).unwrap().unwrap();
    assert_eq!(child.parent_id, Some(topic.id));

    // Delete (cascades to child)
    store.delete_topic(topic.id).unwrap();
    assert!(store.data.topics.is_empty());
    assert!(store.data.document_topics.is_empty());
}

#[test]
fn test_document_linking_and_move() {
    let mut store = test_store();
    let input = store.root_path.join("paper.txt");
    std::fs::write(&input, "test content").unwrap();
    store.import_files(&[input]).unwrap();
    let doc_id = store.data.documents[0].id;

    let topic_a = store.create_topic("A", None).unwrap().unwrap();
    let topic_b = store.create_topic("B", None).unwrap().unwrap();

    // Link to both topics
    store.link_document(doc_id, topic_a.id).unwrap();
    store.link_document(doc_id, topic_b.id).unwrap();

    assert_eq!(store.documents_for_topic(Some(topic_a.id)).len(), 1);
    assert_eq!(store.documents_for_topic(Some(topic_b.id)).len(), 1);

    // Move from A to unclassified (removes ALL topic associations)
    assert!(store.move_document(doc_id, Some(topic_a.id), None).unwrap());
    assert_eq!(store.documents_for_topic(Some(topic_a.id)).len(), 0);
    assert_eq!(store.documents_for_topic(Some(topic_b.id)).len(), 0);
}

#[test]
fn test_bookmark_toggle() {
    let mut store = test_store();
    // Create a minimal PDF in the store
    store.data.documents.push(KnowledgeDocument {
        id: uuid::Uuid::new_v4(),
        name: "test.pdf".into(),
        display_name: None,
        extension_name: ".pdf".into(),
        size: 100,
        sha256: "abc123".into(),
        stored_path: None,
        imported_at: chrono::Utc::now(),
        status: "ready".into(),
        page_count: Some(10),
        error: None,
        source_url: None,
    });
    let doc_id = store.data.documents[0].id;

    // Set bookmark
    assert!(store.toggle_bookmark(doc_id, 3).unwrap());
    assert_eq!(store.bookmark_page_for(doc_id), Some(3));

    // Move bookmark
    assert!(store.toggle_bookmark(doc_id, 5).unwrap());
    assert_eq!(store.bookmark_page_for(doc_id), Some(5));

    // Toggle off
    assert!(!store.toggle_bookmark(doc_id, 5).unwrap());
    assert_eq!(store.bookmark_page_for(doc_id), None);

    // Reject out of range
    assert!(!store.toggle_bookmark(doc_id, 99).unwrap());
    assert!(!store.toggle_bookmark(doc_id, -1).unwrap());
}

#[test]
fn test_annotation_crud() {
    let mut store = test_store();
    let doc_id = uuid::Uuid::new_v4();
    store.data.documents.push(KnowledgeDocument {
        id: doc_id,
        name: "paper.pdf".into(),
        display_name: None,
        extension_name: ".pdf".into(),
        size: 200,
        sha256: "def456".into(),
        stored_path: None,
        imported_at: chrono::Utc::now(),
        status: "ready".into(),
        page_count: Some(20),
        error: None,
        source_url: None,
    });

    let sel = ReaderSelection {
        text: "关键结论".into(),
        page: Some(3),
        rects: vec![AnnotationRect { page: 3, x: 10.0, y: 20.0, width: 100.0, height: 20.0 }],
        anchor_x: None,
        anchor_y: None,
    };

    // Add highlight
    let ann = store.add_annotation(doc_id, &sel, "highlight", "").unwrap();
    assert_eq!(ann.kind, "highlight");
    assert_eq!(store.annotations_for(doc_id).len(), 1);

    // Update with note
    store.update_annotation(ann.id, "重要发现").unwrap();
    let updated = &store.data.annotations[0];
    assert_eq!(updated.note, "重要发现");

    // Delete
    store.delete_annotation(ann.id).unwrap();
    assert!(store.annotations_for(doc_id).is_empty());
}

#[test]
fn test_summary_notes() {
    let mut store = test_store();
    let doc_id = uuid::Uuid::new_v4();
    store.data.documents.push(KnowledgeDocument {
        id: doc_id, name: "ref.pdf".into(), display_name: None,
        extension_name: ".pdf".into(), size: 100, sha256: "xyz".into(),
        stored_path: None, imported_at: chrono::Utc::now(),
        status: "ready".into(), page_count: Some(5),
        error: None, source_url: None,
    });

    let sel = ReaderSelection { text: "引用".into(), page: Some(1), rects: vec![], anchor_x: None, anchor_y: None };
    let ann = store.add_annotation(doc_id, &sel, "note", "笔记内容").unwrap();

    // Create summary note
    let note = store.create_summary_note("综述", "# 标题\n\n正文", &[ann.id]).unwrap().unwrap();
    assert_eq!(note.title, "综述");

    let md = store.summary_note_markdown_for(&note).unwrap();
    assert!(md.contains("# 综述"));

    // Update
    store.update_summary_note(note.id, "综述v2", "新内容", &[ann.id]).unwrap();
    let updated = &store.data.summary_notes[0];
    assert_eq!(updated.title, "综述v2");

    // Delete annotation cleans up reference
    store.delete_annotation(ann.id).unwrap();
    assert!(store.data.summary_notes[0].annotation_ids.is_empty());
}

#[test]
fn test_conversation_save_and_load() {
    let mut store = test_store();

    let conv = Conversation {
        id: uuid::Uuid::new_v4(),
        title: "测试对话".into(),
        document_ids: vec![],
        topic_ids: vec![],
        include_current_page: false,
        include_annotations: true,
        current_document_id: None,
        messages: vec![
            ChatMessage {
                id: uuid::Uuid::new_v4(),
                role: "user".into(),
                content: "你好".into(),
                prompt_content: None,
                quote: None,
                sources: None,
                backend: None,
                generated_files: None,
                pending_imports: None,
                trace_events: None,
                created_at: chrono::Utc::now(),
            }
        ],
        summary: String::new(),
        summary_message_count: 0,
        agent_sessions: std::collections::HashMap::new(),
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    store.save_conversation(&conv).unwrap();
    assert_eq!(store.data.conversations.len(), 1);
    assert_eq!(store.data.conversations[0].messages.len(), 1);
}

#[test]
fn test_context_chunks() {
    let mut store = test_store();
    let doc_id = uuid::Uuid::new_v4();
    store.data.documents.push(KnowledgeDocument {
        id: doc_id, name: "rag.txt".into(), display_name: Some("RAG论文".into()),
        extension_name: ".txt".into(), size: 50, sha256: "abc".into(),
        stored_path: None, imported_at: chrono::Utc::now(),
        status: "ready".into(), page_count: None,
        error: None, source_url: None,
    });

    // Write extracted content
    let extracted = ExtractedDocument {
        text: "RAG 使用检索增强生成来改进大语言模型的知识问答能力。".into(),
        pages: vec![],
    };
    let index_path = store.index_dir().join(format!("{}.json", doc_id));
    std::fs::write(&index_path, serde_json::to_string(&extracted).unwrap()).unwrap();

    let chunks = store.context_chunks("RAG", &[doc_id], &[]);
    assert!(!chunks.is_empty(), "Should find RAG context chunks");
    assert_eq!(chunks[0].document_name, "RAG论文");
}

#[test]
fn test_search_across_topics() {
    let mut store = test_store();
    let input = store.root_path.join("ai.txt");
    std::fs::write(&input, "人工智能正在改变世界。").unwrap();
    store.import_files(&[input]).unwrap();
    let doc_id = store.data.documents[0].id;

    let topic = store.create_topic("科技", None).unwrap().unwrap();
    store.link_document(doc_id, topic.id).unwrap();

    // Search within topic
    let results = store.search("人工智能", Some(topic.id));
    assert_eq!(results.len(), 1);

    // Search all
    let results_all = store.search("人工智能", None);
    assert_eq!(results_all.len(), 1);

    // Search non-matching
    let empty = store.search("不存在", None);
    assert!(empty.is_empty());
}

#[test]
fn test_recommendations() {
    let mut store = test_store();
    let doc_id = uuid::Uuid::new_v4();
    store.data.documents.push(KnowledgeDocument {
        id: doc_id, name: "rag-paper.pdf".into(),
        display_name: Some("RAG for Knowledge-Intensive NLP Tasks".into()),
        extension_name: ".pdf".into(), size: 1000, sha256: "hash".into(),
        stored_path: None, imported_at: chrono::Utc::now(),
        status: "ready".into(), page_count: Some(10),
        error: None, source_url: None,
    });

    let extracted = ExtractedDocument {
        text: "检索增强生成 RAG 是一种结合知识库和大模型的技术。".into(),
        pages: vec![],
    };
    let index_path = store.index_dir().join(format!("{}.json", doc_id));
    std::fs::write(&index_path, serde_json::to_string(&extracted).unwrap()).unwrap();

    let recs = store.recommend_topics_for(&store.data.documents[0]);
    assert!(!recs.is_empty(), "Should have recommendations for RAG paper");

    // Apply recommendations
    store.apply_recommendations(&recs, doc_id).unwrap();
    assert!(!store.data.topics.is_empty(), "Should create recommendation topics");
}

#[test]
fn test_json_roundtrip() {
    // Test that serialize → deserialize preserves data (backward compat)
    let mut store = test_store();
    let doc_id = uuid::Uuid::new_v4();
    store.data.documents.push(KnowledgeDocument {
        id: doc_id, name: "test.pdf".into(), display_name: Some("Display Name".into()),
        extension_name: ".pdf".into(), size: 500, sha256: "abcdef".into(),
        stored_path: Some("source/documents/test.pdf".into()),
        imported_at: chrono::Utc::now(), status: "ready".into(),
        page_count: Some(42), error: None, source_url: Some("https://example.com".into()),
    });
    store.create_topic("Test", None).unwrap();
    store.save().unwrap();

    // Reload
    let path = store.metadata_path();
    let store2 = KnowledgeStore::new(Some(store.root_path.clone())).unwrap();
    assert_eq!(store2.data.documents.len(), 1);
    assert_eq!(store2.data.documents[0].display_title(), "Display Name");
    assert_eq!(store2.data.documents[0].page_count, Some(42));
    assert_eq!(store2.data.documents[0].source_url, Some("https://example.com".into()));
    assert_eq!(store2.data.topics.len(), 1);
    assert_eq!(store2.data.topics[0].name, "Test");
}

#[test]
fn test_delete_document_cleanup() {
    let mut store = test_store();
    let input = store.root_path.join("doc.txt");
    std::fs::write(&input, "content").unwrap();
    store.import_files(&[input]).unwrap();
    let doc_id = store.data.documents[0].id;

    // Add annotation linked to this doc
    let sel = ReaderSelection { text: "text".into(), page: None, rects: vec![], anchor_x: None, anchor_y: None };
    let ann_id = store.add_annotation(doc_id, &sel, "highlight", "").unwrap().id;

    // Add summary note linking the annotation
    store.create_summary_note("Note", "body", &[ann_id]).unwrap();

    // Delete document
    store.delete_document(doc_id).unwrap();
    assert!(store.data.documents.is_empty());
    assert!(store.data.annotations.is_empty());
    // Summary note should have its annotation_ids cleaned
    assert!(store.data.summary_notes[0].annotation_ids.is_empty());
}

#[test]
fn test_chunking_and_scoring() {
    let text = String::from_utf8(vec![b'A'; 3200]).unwrap();
    let chunks = knowledge_master_lib::store::chunks(&text, 1000, 100);
    assert_eq!(chunks.len(), 4, "3200 chars with 1000 size, 100 overlap = 4 chunks");

    let score = knowledge_master_lib::store::score("数据库", "数据库性能分析", "设计");
    assert!(score > 0, "Score should be positive for matching text");
}
