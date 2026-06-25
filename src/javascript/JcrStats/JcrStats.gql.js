import {gql} from '@apollo/client';

export const COMPUTE = gql`
    mutation JcrStatsCompute($path: String) {
        jcrStats {
            compute(path: $path)
        }
    }
`;

export const CANCEL = gql`
    mutation JcrStatsCancel {
        jcrStats {
            cancel
        }
    }
`;

export const GET_STATUS = gql`
    query JcrStatsStatus {
        jcrStats {
            status {
                running
                path
                error
                hasResult
                startedAt
                elapsedMs
                visitedCount
                cancelled
            }
        }
    }
`;

export const GET_EXCLUSIONS = gql`
    query JcrStatsExclusions {
        jcrStats {
            exclusions
        }
    }
`;

export const ADD_EXCLUSION = gql`
    mutation JcrStatsAddExclusion($path: String!) {
        jcrStats {
            addExclusion(path: $path)
        }
    }
`;

export const REMOVE_EXCLUSION = gql`
    mutation JcrStatsRemoveExclusion($path: String!) {
        jcrStats {
            removeExclusion(path: $path)
        }
    }
`;

export const SAVE_SNAPSHOT = gql`
    mutation JcrStatsSaveSnapshot($json: String!) {
        jcrStats {
            saveSnapshot(json: $json)
        }
    }
`;

export const GET_SNAPSHOTS = gql`
    query JcrStatsSnapshots {
        jcrStats {
            snapshots {
                path
                name
                url
                createdAt
                size
            }
        }
    }
`;

export const DELETE_SNAPSHOT = gql`
    mutation JcrStatsDeleteSnapshot($path: String!) {
        jcrStats {
            deleteSnapshot(path: $path)
        }
    }
`;

export const GET_RESULT = gql`
    query JcrStatsResult($maxDepth: Int) {
        jcrStats {
            result(maxDepth: $maxDepth) {
                name
                path
                size
                nodeCount
                children {
                    name
                    path
                    size
                    nodeCount
                    children {
                        name
                        path
                        size
                        nodeCount
                        children {
                            name
                            path
                            size
                            nodeCount
                            children {
                                name
                                path
                                size
                                nodeCount
                                children {
                                    name
                                    path
                                    size
                                    nodeCount
                                    children {
                                        name
                                        path
                                        size
                                        nodeCount
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;
